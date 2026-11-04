import Image from "next/image";
import logo from "./pis-logo.png";

/** PIS 品牌 Logo（设计定稿的位图资源）。 */
export function Logo() {
  return (
    <Image
      src={logo}
      alt="PIS"
      preload
      className="h-10 w-auto shrink-0 select-none"
    />
  );
}
