"use client";

import { ArrowLeft, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  TapTabLivePanel,
  type TapTabPaymentLinkState,
} from "./TapTabLivePanel";
import { buildTapTabFullBillHref } from "./taptab-live-helpers";
import { useTapTabWallet } from "./wallet";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function subscribeToLocation(update: () => void) {
  window.addEventListener("popstate", update);
  window.addEventListener("hashchange", update);
  return () => {
    window.removeEventListener("popstate", update);
    window.removeEventListener("hashchange", update);
  };
}

function getLocationHref() {
  return window.location.href;
}

function getServerLocationHref() {
  return "";
}

export function TapTabPaymentRoute() {
  const wallet = useTapTabWallet();
  const locationHref = useSyncExternalStore(
    subscribeToLocation,
    getLocationHref,
    getServerLocationHref,
  );
  const fullBillHref = locationHref
    ? buildTapTabFullBillHref(locationHref)
    : "/?workspace=live#bill";
  const [paymentLinkState, setPaymentLinkState] = useState<TapTabPaymentLinkState>({
    status: "checking",
  });
  const handlePaymentLinkState = useCallback((state: TapTabPaymentLinkState) => {
    setPaymentLinkState((current) => {
      if (
        current.status === state.status &&
        (current.status !== "trusted" ||
          state.status !== "trusted" ||
          current.participantAddress === state.participantAddress) &&
        (current.status !== "rejected" ||
          state.status !== "rejected" ||
          current.reason === state.reason)
      ) {
        return current;
      }
      return state;
    });
  }, []);

  const trustedPayment = paymentLinkState.status === "trusted";
  const title =
    paymentLinkState.status === "trusted"
      ? "Your personal payment is ready."
      : paymentLinkState.status === "rejected"
        ? "This payment link cannot be used safely."
        : "Checking your personal payment link.";

  return (
    <main className="payment-route-shell">
      <header className="payment-route-header">
        <Link href="/?workspace=preview&preview=table-7#bill" className="tap-brand">
          <span className="tap-brand-mark" aria-hidden="true">T</span>
          <span>TapTab</span>
        </Link>
        <Link href={fullBillHref} className="payment-route-back">
          <ArrowLeft size={16} aria-hidden="true" /> Full bill
        </Link>
      </header>

      <section className="payment-route-intro" aria-labelledby="payment-route-title">
        <span className="section-kicker">Personal payment</span>
        <h1 id="payment-route-title">{title}</h1>
        <p>
          {trustedPayment
            ? "The beneficiary has been checked against the exact contract and bill in this link. Organiser settlement, cancellation and venue controls stay hidden."
            : "TapTab will only show wallet controls after the contract, bill and beneficiary have all been verified."}
        </p>
        <div className="payment-route-assurances">
          <span><LockKeyhole size={16} aria-hidden="true" /> Exact remaining amount</span>
          <span><ShieldCheck size={16} aria-hidden="true" /> Beneficiary checked against the bill</span>
        </div>
      </section>

      <div
        className={`payment-route-status is-${paymentLinkState.status}`}
        role={paymentLinkState.status === "rejected" ? "alert" : "status"}
        aria-live={paymentLinkState.status === "rejected" ? "assertive" : "polite"}
      >
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>
            {paymentLinkState.status === "trusted"
              ? `Verified beneficiary ${shortAddress(paymentLinkState.participantAddress)}`
              : paymentLinkState.status === "rejected"
                ? "Wallet access remains locked"
                : "Verifying contract, bill and beneficiary"}
          </strong>
          <span>
            {paymentLinkState.status === "trusted"
              ? "The payment panel below is fixed to this participant."
              : paymentLinkState.status === "rejected"
                ? paymentLinkState.reason
                : "No wallet action is available while these checks are in progress."}
          </span>
        </div>
      </div>

      <aside className="payment-route-privacy" role="note">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Payments on Monad are public.</strong>
          <span>
            Wallet addresses, the beneficiary and contribution value can be visible onchain.
            Local display names are not included in this link or written to the contract.
          </span>
        </div>
      </aside>

      {trustedPayment ? (
        <section className="payment-route-wallet" aria-labelledby="payment-wallet-title">
          <div>
            <span className="section-kicker">Your wallet</span>
            <h2 id="payment-wallet-title">
              {wallet.account && wallet.provider
                ? `Connected as ${shortAddress(wallet.account)}`
                : wallet.account
                  ? "Restoring your wallet session"
                  : "Connect to continue"}
            </h2>
            {wallet.setupMessage ? <p>{wallet.setupMessage}</p> : null}
            {!wallet.account ? (
              <p>
                Inspecting this payment request needs no wallet. Connecting with email, social
                sign-in or a compatible EVM wallet does not submit a transaction or move MON.
              </p>
            ) : null}
          </div>
          {wallet.account && wallet.provider ? (
            <button type="button" className="quiet-button" onClick={() => void wallet.disconnect()}>
              Disconnect
            </button>
          ) : wallet.account ? (
            <div className="live-wallet-actions">
              <button
                type="button"
                className="quiet-button"
                onClick={wallet.refreshConnection}
              >
                Refresh connection
              </button>
              <button type="button" className="quiet-button" onClick={wallet.openWallets}>
                Choose another wallet
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="lock-button"
              onClick={
                wallet.status === "error" && !wallet.ready
                  ? wallet.retryInitialisation
                  : wallet.open
              }
              disabled={
                !wallet.enabled ||
                wallet.isConnecting ||
                (!wallet.ready && wallet.status !== "error")
              }
            >
              <Wallet size={16} aria-hidden="true" />
              {wallet.isConnecting || (wallet.enabled && !wallet.ready)
                ? wallet.status === "error"
                  ? "Retry wallet setup"
                  : "Preparing wallet…"
                : wallet.enabled
                  ? wallet.onboarding.primaryLabel
                  : "Wallet setup unavailable"}
            </button>
          )}
        </section>
      ) : null}

      <TapTabLivePanel
        active
        className={`payment-route-live ${trustedPayment ? "is-payment-trusted" : "is-payment-locked"}`}
        onPaymentLinkState={handlePaymentLinkState}
      />
    </main>
  );
}
