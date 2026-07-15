"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

type ConfirmSubmitButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "onClick" | "type"
> & {
  children: ReactNode;
  message: string;
};

export function ConfirmSubmitButton({
  children,
  message,
  ...buttonProps
}: ConfirmSubmitButtonProps) {
  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      type="submit"
    >
      {children}
    </button>
  );
}
