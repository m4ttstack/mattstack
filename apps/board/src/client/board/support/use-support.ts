import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SupportPart } from '@mattstack/rt-client';
import type { SupportRead } from '../../../support.ts';
import { getParts, getRequests, getSupport, sendRequest } from './support-api.ts';
import {
  byPartOrder,
  currentRequest,
  isOpen,
  type HelpMr,
  type HelpRequest,
  type SendError,
} from './support-model.ts';

const SEEN_KEY = 'board-support-seen';
const SEEN_MAX = 50;
const SETTLED_POLL_MS = 60_000;
const OPEN_POLL_MS = 4_000;

function loadSeen(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // Remembered for this page only.
  }
}

/** The board may be read over plain http by name, where `randomUUID` is
    missing. */
function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Help {
  read: SupportRead;
  request: HelpRequest | null;
  requests: readonly HelpRequest[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the form about one MR. */
  askAbout: (mr: HelpMr) => void;
  text: string;
  setText: (text: string) => void;
  mr: HelpMr | null;
  /** What goes with it; null while it loads. */
  parts: SupportPart[] | null;
  /** rt could not say what would go with it, so nothing can be sent. */
  partsFailed: boolean;
  loadParts: () => void;
  removePart: (key: SupportPart['key']) => void;
  sending: boolean;
  error: SendError | null;
  clearError: () => void;
  send: () => void;
  /** The form again, holding a settled request's words. */
  askAgain: (text: string) => void;
  markSeen: (id: string) => void;
}

/** The help button's state; null while the board has no one to ask. */
export function useSupport(local: boolean): Help | null {
  const [read, setRead] = useState<SupportRead | null>(null);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const [open, setOpenState] = useState(false);
  const [text, setText] = useState('');
  const [mr, setMr] = useState<HelpMr | null>(null);
  const [parts, setParts] = useState<SupportPart[] | null>(null);
  const [partsFailed, setPartsFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const asking = useRef(0);
  const attempt = useRef<{ id: string; body: string } | null>(null);

  const refreshRequests = useCallback(async () => {
    const r = await getRequests();
    if (r) setRequests(r);
  }, []);

  useEffect(() => {
    if (!local) return;
    let live = true;
    const load = () => {
      if (document.hidden) return;
      void getSupport().then(r => live && r && setRead(r));
    };
    load();
    const timer = setInterval(load, SETTLED_POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [local]);

  const offered = local && read !== null && read.availability.state !== 'hidden';
  const anyOpen = requests.some(isOpen);
  useEffect(() => {
    if (!local || !read) return;
    const load = () => {
      if (!document.hidden) void refreshRequests();
    };
    load();
    const timer = setInterval(load, anyOpen ? OPEN_POLL_MS : SETTLED_POLL_MS);
    return () => clearInterval(timer);
  }, [local, read !== null, anyOpen, refreshRequests]);

  const request = useMemo(
    () => currentRequest(requests, new Set(seen), Date.now()),
    [requests, seen]
  );

  const markSeen = useCallback((id: string) => {
    setSeen(s => {
      if (s.includes(id)) return s;
      const next = [...s, id].slice(-SEEN_MAX);
      saveSeen(next);
      return next;
    });
  }, []);

  const loadParts = useCallback((about: HelpMr | null) => {
    const mine = ++asking.current;
    setParts(null);
    setPartsFailed(false);
    void getParts(about).then(p => {
      if (mine !== asking.current) return;
      if (p) setParts([...p].sort(byPartOrder));
      else setPartsFailed(true);
    });
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !open && parts === null) loadParts(mr);
      if (!next) {
        setError(null);
        if (request && !isOpen(request)) markSeen(request.id);
      }
      setOpenState(next);
    },
    [open, parts, mr, request, loadParts, markSeen]
  );

  const askAbout = useCallback(
    (about: HelpMr) => {
      setError(null);
      setMr(about);
      loadParts(about);
      if (request && !isOpen(request)) markSeen(request.id);
      setOpenState(true);
    },
    [request, loadParts, markSeen]
  );

  const askAgain = useCallback(
    (words: string) => {
      setText(words);
      setMr(null);
      loadParts(null);
      setError(null);
      if (request) markSeen(request.id);
    },
    [request, loadParts, markSeen]
  );

  const send = useCallback(() => {
    if (sending || parts === null || !text.trim()) return;
    const words = text.trim();
    const body = JSON.stringify([words, parts]);
    // rt takes a retry under the same id, and changed words as a new request.
    if (attempt.current?.body !== body) attempt.current = { id: newId(), body };
    setSending(true);
    setError(null);
    void sendRequest({ id: attempt.current.id, text: words, parts })
      .then(async err => {
        await refreshRequests();
        if (err) return setError(err);
        attempt.current = null;
        setText('');
        setMr(null);
        setParts(null);
      })
      .finally(() => setSending(false));
  }, [sending, parts, text, refreshRequests]);

  if (!read || (!offered && !request)) return null;
  return {
    read,
    request,
    requests,
    open,
    setOpen,
    askAbout,
    text,
    setText,
    mr,
    parts,
    partsFailed,
    loadParts: () => loadParts(mr),
    removePart: key => setParts(p => p?.filter(x => x.key !== key) ?? null),
    sending,
    error,
    clearError: () => setError(null),
    send,
    askAgain,
    markSeen,
  };
}
