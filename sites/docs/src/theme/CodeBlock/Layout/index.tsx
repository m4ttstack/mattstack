import React from "react";
import clsx from "clsx";
import { useCodeBlockContext } from "@docusaurus/theme-common/internal";
import Container from "@theme/CodeBlock/Container";
import Title from "@theme/CodeBlock/Title";
import Content from "@theme/CodeBlock/Content";
import Buttons from "@theme/CodeBlock/Buttons";
import type { Props } from "@theme/CodeBlock/Layout";

export default function CodeBlockLayout({ className }: Props): React.JSX.Element {
  const { metadata } = useCodeBlockContext();
  const label = metadata.title ?? (metadata.language === "text" ? undefined : metadata.language);
  return (
    <Container as="div" className={clsx(className, metadata.className)}>
      {label ? (
        <div className="ms-code-header">
          <span className="ms-code-label">
            <Title>{label}</Title>
          </span>
          <Buttons className="ms-code-buttons" />
        </div>
      ) : null}
      <div className="ms-code-content">
        <Content />
        {label ? null : <Buttons />}
      </div>
    </Container>
  );
}
