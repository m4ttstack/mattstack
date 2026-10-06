import React from "react";
import Mermaid from "@theme-original/Mermaid";
import type MermaidType from "@theme/Mermaid";
import type { WrapperProps } from "@docusaurus/types";
import { useColorMode } from "@docusaurus/theme-common";

type Props = WrapperProps<typeof MermaidType>;

// A page that loads in dark mode renders each diagram twice, light then dark, under one
// mermaid id, and the two renders race: the second diagram on the page came out empty.
// Keying on the mode remounts the diagram with a fresh id instead.
export default function MermaidWrapper(props: Props): React.JSX.Element {
  const { colorMode } = useColorMode();
  return <Mermaid key={colorMode} {...props} />;
}
