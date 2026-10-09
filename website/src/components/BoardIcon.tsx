import React, { useId } from "react";
import styles from "./BoardIcon.module.css";

/* Path data copied from apps/board/src/client/board/icons.tsx (lucide path data, ISC licensed, https://lucide.dev). */
const PATHS = {
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15 6a9 9 0 0 0-9 9",
  dismiss: "M18 6 6 18M6 6l12 12",
  note: "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2ZM14 21v-5a2 2 0 0 1 2-2h5M7 8h8M7 12h5",
  draft: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  autoMerge:
    "M4 14a1 1 0 0 1-.8-1.6l8.7-10.5a.5.5 0 0 1 .9.4l-1.3 6.9h7.5a1 1 0 0 1 .8 1.6l-8.7 10.5a.5.5 0 0 1-.9-.4l1.3-6.9Z",
  merge: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21V9a9 9 0 0 0 9 9",
  out: "M7 7h10v10M7 17 17 7",
  refresh:
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
} as const;

const SLACK_TILES: Array<[string, string]> = [
  [
    "#E3066A",
    "M84.039,252.769c0,23.127-18.893,42.02-42.02,42.02S0,275.896,0,252.769s18.893-42.02,42.02-42.02h42.02v42.02Z M105.212,252.769c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02c0,0,0-105.212,0-105.212Z",
  ],
  [
    "#00B3FF",
    "M147.231,84.039c-23.127,0-42.02-18.893-42.02-42.02S124.104,0,147.231,0s42.02,18.893,42.02,42.02v42.02h-42.02Z M147.231,105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02H42.02c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02c0,0,105.212,0,105.212,0Z",
  ],
  [
    "#41B658",
    "M315.961,147.231c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02-18.893,42.02-42.02,42.02h-42.02v-42.02Z M294.788,147.231c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02V42.02c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212Z",
  ],
  [
    "#FCC003",
    "M252.769,315.961c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02-42.02-18.893-42.02-42.02v-42.02h42.02Z M252.769,294.788c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02h105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02h-105.212Z",
  ],
];

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type Name = keyof typeof PATHS | "agent" | "agentCloud" | "slack";
type Lane = "review" | "respond" | "doctor";

function Bot() {
  return (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </>
  );
}

function AgentCloud({ label }: { label: string }) {
  const mask = useId();
  return (
    <svg
      className={styles.icon}
      width={20}
      height={15}
      viewBox="0 0 19.5 15"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="19.5" height="15">
          <rect width="19.5" height="15" fill="white" />
          <rect x="0" y="6.3" width="11.1" height="8.7" rx="2.6" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path
          transform="translate(5.9 0) scale(0.5833)"
          d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
          stroke="currentColor"
          strokeWidth={2.6}
        />
      </g>
      <g className={styles.cloudBot} transform="translate(0 4) scale(0.4583)" strokeWidth={3.3}>
        <Bot />
      </g>
    </svg>
  );
}

export default function BoardIcon({ name, lane, emoji }: { name?: Name; lane?: Lane; emoji?: string }) {
  if (emoji)
    return (
      <span className={styles.emoji} role="img" aria-label="reaction">
        {emoji}
      </span>
    );
  const label = lane ? `${lane} agent` : name ?? "";
  if (name === "agentCloud") return <AgentCloud label={label} />;
  if (name === "slack")
    return (
      <svg className={styles.icon} width={16} height={16} viewBox="0 0 400 400" role="img" aria-label="slack">
        {SLACK_TILES.map(([fill, d]) => (
          <path key={fill} fill={fill} d={d} />
        ))}
      </svg>
    );
  return (
    <svg
      {...STROKE}
      className={`${styles.icon} ${lane ? styles[lane] : ""}`}
      width={17}
      height={17}
      role="img"
      aria-label={label}
    >
      {name === "agent" ? <Bot /> : <path d={PATHS[name as keyof typeof PATHS]} />}
    </svg>
  );
}
