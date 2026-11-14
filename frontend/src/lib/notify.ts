import Swal, { type SweetAlertIcon, type SweetAlertResult } from "sweetalert2";

const DARK_THEME = {
  background: "#0F172A",
  color: "#E2E8F0",
  confirmButtonColor: "#0891B2",
  cancelButtonColor: "#334155",
  customClass: {
    container: "!z-[9999]",
    popup: "!border !border-slate-700/80 !rounded-2xl !shadow-2xl !text-sm",
    title: "!text-slate-100 !text-sm !font-semibold",
    htmlContainer: "!text-slate-300 !text-xs",
    confirmButton: "!rounded-lg !px-3.5 !py-2 !text-xs !font-semibold",
    cancelButton: "!rounded-lg !px-3.5 !py-2 !text-xs !font-semibold",
    timerProgressBar: "!bg-cyan-400/70",
  },
} as const;

export interface ToastOptions {
  icon: SweetAlertIcon;
  title: string;
  text?: string;
  timer?: number;
}

export interface AlertOptions {
  icon: SweetAlertIcon;
  title: string;
  text?: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
  showCancelButton?: boolean;
}

export function notifyToast({ icon, title, text, timer = 4500 }: ToastOptions): void {
  void Swal.fire({
    ...DARK_THEME,
    toast: true,
    position: "top-end",
    icon,
    title,
    text,
    showConfirmButton: false,
    showCloseButton: true,
    timer,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
    },
  });
}

export function notifyAlert({
  icon,
  title,
  text,
  confirmButtonText,
  cancelButtonText,
  showCancelButton = false,
}: AlertOptions): Promise<SweetAlertResult> {
  return Swal.fire({
    ...DARK_THEME,
    icon,
    title,
    text,
    confirmButtonText,
    cancelButtonText,
    showCancelButton,
    reverseButtons: true,
  });
}

export interface LiveDateRangePromptOptions {
  title: string;
  subtitle: string;
  fromLabel: string;
  toLabel: string;
  confirmText: string;
  cancelText: string;
  initialFrom: string;
  initialTo: string;
  maxDate: string;
  maxDays: number;
  invalidRangeError: string;
  tooLongError: string;
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function isoOffsetFrom(anchorIso: string, deltaDays: number): string {
  const d = new Date(`${anchorIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function promptLiveDateRange(
  opts: LiveDateRangePromptOptions,
): Promise<{ from: string; to: string } | null> {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const res = await Swal.fire<{ from: string; to: string }>({
    ...DARK_THEME,
    title: opts.title,
    showCancelButton: true,
    confirmButtonText: opts.confirmText,
    cancelButtonText: opts.cancelText,
    reverseButtons: true,
    focusConfirm: false,
    html: `
      <div class="text-left space-y-3 pt-1">
        <p class="text-xs text-slate-400 font-mono">${esc(opts.subtitle)}</p>
        <div class="grid grid-cols-5 gap-1.5">
          ${(opts.maxDays >= 60 ? [1, 5, 14, 30, 60] : [1, 3, 5, 14, 30])
            .map(
              (d) =>
                `<button type="button" data-live-preset="${d}" class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs font-semibold text-slate-200 hover:border-cyan-500 hover:text-cyan-200 transition">${d}d</button>`,
            )
            .join("")}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold text-slate-400">${esc(opts.fromLabel)}</span>
            <input id="swal-live-from" type="date" value="${esc(opts.initialFrom)}" max="${esc(opts.maxDate)}"
              class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold text-slate-400">${esc(opts.toLabel)}</span>
            <input id="swal-live-to" type="date" value="${esc(opts.initialTo)}" max="${esc(opts.maxDate)}"
              class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none" />
          </label>
        </div>
        <div class="flex items-center justify-between text-[11px] font-mono">
          <span class="text-slate-400">Max ${opts.maxDays}d</span>
          <span id="swal-live-span" class="font-semibold text-cyan-300"></span>
        </div>
      </div>
    `,
    didOpen: (popup) => {
      const fromEl = popup.querySelector<HTMLInputElement>("#swal-live-from");
      const toEl = popup.querySelector<HTMLInputElement>("#swal-live-to");
      const spanEl = popup.querySelector<HTMLElement>("#swal-live-span");
      const updateSpan = () => {
        if (!fromEl || !toEl || !spanEl) return;
        const span = daysBetweenInclusive(fromEl.value, toEl.value);
        if (span < 1 || fromEl.value > opts.maxDate || toEl.value > opts.maxDate) {
          spanEl.textContent = "Invalid";
          spanEl.className = "font-semibold text-rose-400";
        } else if (span > opts.maxDays) {
          spanEl.textContent = `${span}/${opts.maxDays}d`;
          spanEl.className = "font-semibold text-rose-400";
        } else {
          spanEl.textContent = `${span}/${opts.maxDays}d`;
          spanEl.className = "font-semibold text-cyan-300";
        }
      };
      updateSpan();
      fromEl?.addEventListener("input", () => {
        if (toEl && fromEl.value && (!toEl.value || fromEl.value > toEl.value)) {
          toEl.value = fromEl.value;
        }
        Swal.resetValidationMessage();
        updateSpan();
      });
      toEl?.addEventListener("input", () => {
        Swal.resetValidationMessage();
        updateSpan();
      });
      popup.querySelectorAll<HTMLButtonElement>("[data-live-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const d = Number(btn.dataset.livePreset || 5);
          if (fromEl && toEl) {
            toEl.value = opts.maxDate;
            fromEl.value = isoOffsetFrom(opts.maxDate, -(d - 1));
            Swal.resetValidationMessage();
            updateSpan();
          }
        });
      });
    },
    preConfirm: () => {
      const popup = Swal.getPopup();
      const from = popup?.querySelector<HTMLInputElement>("#swal-live-from")?.value ?? "";
      const to = popup?.querySelector<HTMLInputElement>("#swal-live-to")?.value ?? "";
      const span = daysBetweenInclusive(from, to);
      if (!from || !to || span < 1 || from > opts.maxDate || to > opts.maxDate) {
        Swal.showValidationMessage(opts.invalidRangeError);
        return false;
      }
      if (span > opts.maxDays) {
        Swal.showValidationMessage(opts.tooLongError);
        return false;
      }
      return { from, to };
    },
  });

  return res.isConfirmed && res.value ? res.value : null;
}

export interface ExtendDaysPromptOptions {
  title: string;
  subtitle: string;
  daysLabel: string;
  maxAdd: number;
  defaultDays?: number;
  confirmText: string;
  cancelText: string;
  invalidError: string;
}

export async function promptExtendDays(
  opts: ExtendDaysPromptOptions,
): Promise<number | null> {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const maxAdd = Math.max(1, Math.floor(opts.maxAdd));
  const initialVal = Math.min(maxAdd, Math.max(1, opts.defaultDays ?? 5));
  const chips = Array.from(new Set([1, 3, 5, 10, maxAdd].filter((d) => d >= 1 && d <= maxAdd)));

  const res = await Swal.fire<number>({
    ...DARK_THEME,
    title: opts.title,
    showCancelButton: true,
    confirmButtonText: opts.confirmText,
    cancelButtonText: opts.cancelText,
    reverseButtons: true,
    focusConfirm: false,
    html: `
      <div class="text-left space-y-3 pt-1">
        <p class="text-xs text-slate-400 font-mono">${esc(opts.subtitle)}</p>
        <div class="flex flex-wrap gap-1.5">
          ${chips
            .map(
              (d) =>
                `<button type="button" data-extend-chip="${d}" class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs font-semibold text-slate-200 hover:border-cyan-500 hover:text-cyan-200 transition">+${d}d</button>`,
            )
            .join("")}
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-[11px] font-semibold text-slate-400">${esc(opts.daysLabel)} (1-${maxAdd})</span>
          <input id="swal-extend-days" type="number" min="1" max="${maxAdd}" step="1" value="${initialVal}"
            class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none" />
        </label>
      </div>
    `,
    didOpen: (popup) => {
      const inputEl = popup.querySelector<HTMLInputElement>("#swal-extend-days");
      inputEl?.focus();
      inputEl?.select();
      inputEl?.addEventListener("input", () => {
        Swal.resetValidationMessage();
      });
      popup.querySelectorAll<HTMLButtonElement>("[data-extend-chip]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (inputEl) {
            inputEl.value = btn.dataset.extendChip || String(initialVal);
            Swal.resetValidationMessage();
          }
        });
      });
    },
    preConfirm: () => {
      const popup = Swal.getPopup();
      const raw = popup?.querySelector<HTMLInputElement>("#swal-extend-days")?.value ?? "";
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > maxAdd) {
        Swal.showValidationMessage(opts.invalidError);
        return false;
      }
      return n;
    },
  });

  return res.isConfirmed && typeof res.value === "number" ? res.value : null;
}
