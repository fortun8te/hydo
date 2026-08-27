"use strict";

const EVENT_TRIGGERS = [
  { kind: "slack", label: "Slack message" },
  { kind: "git", label: "Git event" },
  { kind: "teams", label: "Teams message" },
  { kind: "linear", label: "Linear issue" },
  { kind: "sentry", label: "Sentry alert" },
  { kind: "pagerduty", label: "PagerDuty incident" },
  { kind: "webhook", label: "Webhook" },
];

const CADENCES = [
  { id: "hourly", label: "Every hour" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "interval", label: "Interval" },
  { id: "advanced", label: "Advanced..." },
];

function eventLabel(kind) {
  return (EVENT_TRIGGERS.find((t) => t.kind === kind) || {}).label || kind;
}

function normalizeTrigger(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || "schedule");
  const cadence = String(raw.cadence || (raw.at ? "once" : "daily"));
  return {
    id: raw.id || `tr-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    cadence: kind === "schedule" ? cadence : raw.cadence || "",
    at: raw.at || null,
    intervalMin: raw.intervalMin || 30,
    cron: raw.cron || "",
  };
}

function triggersFromSpec(spec) {
  if (Array.isArray(spec.triggers) && spec.triggers.length) {
    return spec.triggers.map(normalizeTrigger).filter(Boolean);
  }
  if (spec.at || spec.schedule) {
    const cadence = spec.once || spec.deleteAfter ? "once" : String(spec.schedule || "once");
    return [
      normalizeTrigger({
        kind: "schedule",
        cadence: ["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "advanced", "once"].includes(
          cadence
        )
          ? cadence
          : "once",
        at: spec.at || null,
      }),
    ];
  }
  return [];
}

function nextAt(trigger, fromMs = Date.now()) {
  if (!trigger || trigger.kind !== "schedule") return null;
  const t = new Date(fromMs);
  const seed = trigger.at ? new Date(trigger.at) : t;
  const hh = Number.isNaN(seed.getTime()) ? 9 : seed.getHours();
  const mm = Number.isNaN(seed.getTime()) ? 0 : seed.getMinutes();
  if (trigger.cadence === "once") return trigger.at || null;
  if (trigger.cadence === "hourly") return new Date(fromMs + 60 * 60 * 1000).toISOString();
  if (trigger.cadence === "interval") {
    const m = Math.max(1, Number(trigger.intervalMin) || 30);
    return new Date(fromMs + m * 60 * 1000).toISOString();
  }
  const n = new Date(fromMs);
  n.setSeconds(0, 0);
  n.setHours(hh, mm, 0, 0);
  const bump = () => {
    if (n.getTime() <= fromMs) n.setDate(n.getDate() + 1);
  };
  if (trigger.cadence === "daily") {
    bump();
    return n.toISOString();
  }
  if (trigger.cadence === "weekdays") {
    bump();
    while (n.getDay() === 0 || n.getDay() === 6) n.setDate(n.getDate() + 1);
    return n.toISOString();
  }
  if (trigger.cadence === "weekly") {
    if (n.getTime() <= fromMs) n.setDate(n.getDate() + 7);
    return n.toISOString();
  }
  if (trigger.cadence === "monthly") {
    if (n.getTime() <= fromMs) n.setMonth(n.getMonth() + 1);
    return n.toISOString();
  }
  if (trigger.cadence === "advanced" && trigger.cron) return trigger.at || null;
  return trigger.at || null;
}

function earliestAt(triggers, fromMs = Date.now()) {
  let best = null;
  for (const tr of triggers || []) {
    const at = tr.kind === "schedule" ? tr.at || nextAt(tr, fromMs) : null;
    if (!at) continue;
    const ms = new Date(at).getTime();
    if (Number.isNaN(ms)) continue;
    if (best == null || ms < best) best = ms;
  }
  return best ? new Date(best).toISOString() : null;
}

function labelTrigger(tr) {
  if (!tr) return "Not scheduled";
  if (tr.kind !== "schedule") return eventLabel(tr.kind);
  if (tr.cadence === "once" && tr.at) {
    const d = new Date(tr.at);
    if (!Number.isNaN(d.getTime())) {
      const day = d.toLocaleDateString([], { month: "long", day: "numeric" });
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `Once ${day} at ${time}`;
    }
  }
  const cad = (CADENCES.find((c) => c.id === tr.cadence) || {}).label;
  return cad || "On a schedule";
}

function hermesSchedule(tr) {
  if (!tr || tr.kind !== "schedule") return "";
  if (tr.cadence === "hourly") return "every 1h";
  if (tr.cadence === "daily") return "every 1d";
  if (tr.cadence === "weekdays") return "0 9 * * 1-5";
  if (tr.cadence === "weekly") return "every 7d";
  if (tr.cadence === "monthly") return "0 9 1 * *";
  if (tr.cadence === "interval") return `every ${Math.max(1, tr.intervalMin || 30)}m`;
  if (tr.cadence === "once" && tr.at) return String(tr.at);
  if (tr.cadence === "once") return "1m";
  if (tr.cron) return tr.cron;
  return "";
}

function jobIdFrom(result) {
  if (!result || typeof result !== "object") return null;
  const id = result.job_id || result.id || result.job?.id || result.job?.job_id;
  return id ? String(id) : null;
}

module.exports = {
  EVENT_TRIGGERS,
  CADENCES,
  eventLabel,
  normalizeTrigger,
  triggersFromSpec,
  nextAt,
  earliestAt,
  labelTrigger,
  hermesSchedule,
  jobIdFrom,
};
