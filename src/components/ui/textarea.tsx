import * as React from "react"

import { cn } from "../../lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-border bg-card px-3 py-2.5 text-base shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-muted-foreground/80 hover:border-foreground/35 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/55 dark:aria-invalid:border-destructive/70",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
