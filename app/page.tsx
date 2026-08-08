import type { Metadata } from "next";
import { TapTabApp } from "./TapTabApp";

export const metadata: Metadata = {
  title: "TapTab — Nobody fronts the bill",
  description:
    "Open a shared receipt, claim your items and settle together on Monad.",
};

export default function Home() {
  return <TapTabApp />;
}
