'use client'

import { Progress } from '@/components/ui/progress'

interface CreditBarProps {
  total: number
  spent: number
}

export function CreditBar({ total, spent }: CreditBarProps) {
  const remaining = total - spent
  const percentUsed = total > 0 ? (spent / total) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider">
        <span className="text-muted-foreground">Resource Allocation</span>
        <span className="tabular-nums">
          <span className="font-bold text-primary">{remaining}</span>
          <span className="text-muted-foreground"> / {total} free</span>
        </span>
      </div>
      <Progress value={100 - percentUsed} />
      <p className="text-[11px] font-mono text-muted-foreground">
        {'>'} {spent} credits allocated · cost = votes² (quadratic pricing)
      </p>
    </div>
  )
}
