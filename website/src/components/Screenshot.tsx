import React from "react";
import ThemedImage from "@theme/ThemedImage";
import styles from "./Screenshot.module.css";

export default function Screenshot({ name, alt }: { name: string; alt: string }) {
  return (
    <figure className={styles.figure}>
      <ThemedImage alt={alt} sources={{ light: `/img/${name}-light.png`, dark: `/img/${name}-dark.png` }} />
    </figure>
  );
}
