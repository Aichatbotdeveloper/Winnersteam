"use client";

import { useState, type ComponentProps } from "react";
import { Icon, cn } from "./index";

/** Password field with a show/hide (eye) toggle. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={visible ? "text" : "password"} className={cn(className, "pr-11")} />
      <button type="button" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} title={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-text hover:bg-surface-alt hover:text-ink">
        <Icon name={visible ? "visibility_off" : "visibility"} className="text-[20px]" />
      </button>
    </span>
  );
}
