import type { Metadata } from "next";
import { TapTabPaymentRoute } from "../TapTabPaymentRoute";

export const metadata: Metadata = {
  title: "Pay your TapTab share",
  description: "Open a trusted TapTab payment link and fund one fixed bill participant.",
  robots: { index: false, follow: false },
};

export default function PaymentPage() {
  return <TapTabPaymentRoute />;
}
