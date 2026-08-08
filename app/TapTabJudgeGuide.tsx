"use client";

import { Clock3, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

const REHEARSAL_SECONDS = 3 * 60;

const PITCH_STEPS = [
  {
    range: "0:00–0:25",
    endAt: 25,
    title: "Name the everyday problem",
    script:
      "Groups still pass one card around or trust a private split. TapTab makes receipt ownership, group agreement and funding visible.",
  },
  {
    range: "0:25–1:05",
    endAt: 65,
    title: "Show the local receipt journey",
    script:
      "Use the £48.50 Table 7 sample receipt. Point out the human-verified rows and exact shared-item slots while keeping the Preview labels visible.",
  },
  {
    range: "1:05–1:40",
    endAt: 100,
    title: "Reach group agreement",
    script:
      "Record one diner approval in Organiser & demo controls, change a claim or tip and show that approvals clear. Explain the median tip and opt-in fair remainder.",
  },
  {
    range: "1:40–2:20",
    endAt: 140,
    title: "Demonstrate protected funding",
    script:
      "Approve yourself and record the other diners in Manage diner approvals, then open protected payments. Pay one share, sponsor another and show that settlement stays unavailable until the exact total is funded.",
  },
  {
    range: "2:20–3:00",
    endAt: 180,
    title: "Close with local evidence",
    script:
      "Finish exact funding, confirm settlement, show and exit Stage mode, then download the local judge evidence. Label the browser journey as a deterministic simulation and point to the separate ephemeral Hardhat rehearsal.",
  },
] as const;

export type TapTabJudgeGuideProps = {
  className?: string;
};

export function formatJudgeCountdown(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.min(REHEARSAL_SECONDS, Math.ceil(totalSeconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TapTabJudgeGuide({ className }: TapTabJudgeGuideProps) {
  const titleId = useId();
  const [remainingSeconds, setRemainingSeconds] = useState(REHEARSAL_SECONDS);
  const [isRunning, setIsRunning] = useState(false);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRunning) return undefined;

    const updateClock = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;

      const nextRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0) {
        deadlineRef.current = null;
        setIsRunning(false);
      }
    };

    updateClock();
    const interval = window.setInterval(updateClock, 200);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const elapsedSeconds = REHEARSAL_SECONDS - remainingSeconds;
  const activeStep = useMemo(() => {
    const index = PITCH_STEPS.findIndex((step) => elapsedSeconds < step.endAt);
    return index === -1 ? PITCH_STEPS.length - 1 : index;
  }, [elapsedSeconds]);
  const timerState =
    remainingSeconds === 0 ? "Time" : isRunning ? "Running" : elapsedSeconds > 0 ? "Paused" : "Ready";
  const rootClassName = ["judge-guide", className].filter(Boolean).join(" ");

  function startTimer() {
    const nextRemaining = remainingSeconds === 0 ? REHEARSAL_SECONDS : remainingSeconds;
    deadlineRef.current = Date.now() + nextRemaining * 1_000;
    setRemainingSeconds(nextRemaining);
    setIsRunning(true);
  }

  function pauseTimer() {
    if (deadlineRef.current !== null) {
      setRemainingSeconds(
        Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1_000)),
      );
    }
    deadlineRef.current = null;
    setIsRunning(false);
  }

  function resetTimer() {
    deadlineRef.current = null;
    setIsRunning(false);
    setRemainingSeconds(REHEARSAL_SECONDS);
  }

  return (
    <section className={rootClassName} aria-labelledby={titleId}>
      <header className="judge-guide-header">
        <div>
          <span className="judge-guide-kicker">Local judge rehearsal · 3-minute script</span>
          <h2 id={titleId}>Pitch the local proof, not a deployment.</h2>
          <p>
            This browser journey demonstrates deterministic sample behaviour. It does not
            establish a deployed contract or public transaction.
          </p>
        </div>

        <div className="judge-guide-evidence is-preview">
          <span>
            <ShieldCheck size={13} aria-hidden="true" />
            Local preview only
          </span>
          <strong>No wallet or public network required</strong>
        </div>
      </header>

      <div className="judge-guide-controls">
        <div className="judge-guide-clock">
          <Clock3 size={18} aria-hidden="true" />
          <div>
            <span>{timerState}</span>
            <strong
              role="timer"
              aria-label={`${Math.floor(remainingSeconds / 60)} minutes ${
                remainingSeconds % 60
              } seconds remaining`}
            >
              {formatJudgeCountdown(remainingSeconds)}
            </strong>
          </div>
        </div>

        <div className="judge-guide-buttons" aria-label="Rehearsal timer controls">
          <button type="button" onClick={startTimer} disabled={isRunning}>
            <Play size={14} aria-hidden="true" /> Start
          </button>
          <button type="button" onClick={pauseTimer} disabled={!isRunning}>
            <Pause size={14} aria-hidden="true" /> Pause
          </button>
          <button
            type="button"
            onClick={resetTimer}
            disabled={!isRunning && remainingSeconds === REHEARSAL_SECONDS}
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
        </div>
      </div>

      <div className="judge-guide-progress" aria-hidden="true">
        <span style={{ width: `${(elapsedSeconds / REHEARSAL_SECONDS) * 100}%` }} />
      </div>

      <ol className="judge-guide-steps">
        {PITCH_STEPS.map((step, index) => {
          const isComplete = elapsedSeconds >= step.endAt;
          const isActive = index === activeStep && !isComplete;

          return (
            <li
              key={step.title}
              className={isActive ? "is-active" : isComplete ? "is-complete" : undefined}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="judge-guide-step-number">{index + 1}</span>
              <div>
                <span className="judge-guide-step-time">{step.range}</span>
                <h3>{step.title}</h3>
                <p>{step.script}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
