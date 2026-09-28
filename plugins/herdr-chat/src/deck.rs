use crate::run::{deck_bin, rt_bin, Runner};

/// Pick the viewer URL: `deck()` if it resolved one, else the `setting()`
/// fallback, else an error. Pure: no IO and no JSON parsing live here, so the
/// closures keep it testable.
pub fn viewer_url(
    deck: &dyn Fn() -> Result<String, String>,
    setting: &dyn Fn() -> Option<String>,
) -> Result<String, String> {
    match deck() {
        Ok(url) => Ok(url),
        Err(deck_err) => setting().ok_or_else(|| {
            format!("deck did not resolve a URL ({deck_err}) and chat.viewerUrl is unset")
        }),
    }
}

/// Pull `row.url` out of a `GET /api/v1/apps/<svc>` response body. Returns
/// `None` for an error body or a missing/null `row.url`.
pub fn row_url_from_json(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("row")?
        .get("url")?
        .as_str()
        .map(|s| s.to_string())
}

/// The real IO wrapper around [`viewer_url`]. The `deck` closure tries
/// `deck url chat` first (part 3's verb) and falls back to reading deck's
/// `api.json` port and an HTTP GET parsed by [`row_url_from_json`]; the
/// `setting` closure reads `chat.viewerUrl`. All impure work lives in these
/// closures so [`viewer_url`] stays pure.
pub fn viewer_url_real(runner: &dyn Runner) -> Result<String, String> {
    let deck = || -> Result<String, String> {
        let db = deck_bin();
        if let Ok(out) = runner.run(&[db.as_str(), "url", "chat"], &[]) {
            let u = out.stdout.trim();
            // `deck url` may be an older deck without the verb, printing usage
            // instead of a URL; only a real URL short-circuits.
            if out.status == 0 && u.starts_with("http") {
                return Ok(u.to_string());
            }
        }
        fetch_row_url_via_api().ok_or_else(|| "deck unreachable".to_string())
    };
    let setting = || -> Option<String> {
        let rb = rt_bin();
        let out = runner
            .run(
                &[rb.as_str(), "settings", "get", "chat.viewerUrl", "--json"],
                &[],
            )
            .ok()?;
        if out.status != 0 {
            return None;
        }
        let v: serde_json::Value = serde_json::from_str(&out.stdout).ok()?;
        v.get("value")?.as_str().map(|s| s.to_string())
    };
    viewer_url(&deck, &setting)
}

/// Read deck's `api.json` port and GET `row.url` over loopback HTTP.
fn fetch_row_url_via_api() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let api = std::fs::read_to_string(format!("{home}/.mattstack/deck/api.json")).ok()?;
    let port = serde_json::from_str::<serde_json::Value>(&api)
        .ok()?
        .get("port")?
        .as_u64()?;
    let url = format!("http://127.0.0.1:{port}/api/v1/apps/chat");
    // Explicit connect + read timeouts so a stalled deck returns promptly and the
    // `chat.viewerUrl` fallback stays reachable instead of hanging open-viewer.
    let agent = ureq::builder()
        .timeout_connect(std::time::Duration::from_secs(3))
        .timeout_read(std::time::Duration::from_secs(3))
        .build();
    let body = agent.get(&url).call().ok()?.into_string().ok()?;
    row_url_from_json(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefers_deck_url() {
        let got = viewer_url(&|| Ok("https://chat.mattstack".into()), &|| None);
        assert_eq!(got.unwrap(), "https://chat.mattstack");
    }
    #[test]
    fn falls_back_to_setting_when_deck_fails() {
        let got = viewer_url(&|| Err("no deck".into()), &|| {
            Some("https://chat.mattstack".into())
        });
        assert_eq!(got.unwrap(), "https://chat.mattstack");
    }
    #[test]
    fn errors_when_both_fail() {
        assert!(viewer_url(&|| Err("x".into()), &|| None).is_err());
    }
    #[test]
    fn row_url_from_json_pulls_the_field() {
        assert_eq!(
            row_url_from_json(r#"{"row":{"url":"https://chat.mattstack","published":false}}"#),
            Some("https://chat.mattstack".into())
        );
        assert_eq!(row_url_from_json(r#"{"error":"unknown app"}"#), None);
    }
}
