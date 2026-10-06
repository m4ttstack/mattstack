import React from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";

export default function NavbarLogo(): React.JSX.Element {
  return (
    <Link to="/" className="navbar__brand ms-brand">
      <img className="navbar__logo" src={useBaseUrl("/img/app-icon.png")} alt="" width={26} height={26} />
      <span className="brand-name">
        matt<em>stack</em>
      </span>
    </Link>
  );
}
