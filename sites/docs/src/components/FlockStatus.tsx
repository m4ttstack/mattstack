import React from "react";
import styles from "./FlockStatus.module.css";

type Status = "working" | "blocked" | "done" | "idle" | "background" | "unknown";

export default function FlockStatus({ status }: { status: Status }) {
  return <span className={`${styles.mark} ${styles[status]}`} role="img" aria-label={status} />;
}
