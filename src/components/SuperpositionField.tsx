import { useEffect, useRef } from 'react'

export interface FieldEntry {
  id: string
  label: string
  accent: string
  share: number
  active: boolean
}

interface Props {
  entries: FieldEntry[]
  collapsed: boolean
}

const hashPhase = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997
  }
  return (hash / 997) * Math.PI * 2
}

/**
 * Superpositionsfeld: jede Modellausgabe ist eine Welle, ihre Amplitude folgt dem Gewicht.
 * Die Summenkurve in der Signaturfarbe zeichnet vor, was der Kollaps erzeugen wird.
 */
export function SuperpositionField({ entries, collapsed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dataRef = useRef<{ entries: FieldEntry[]; collapsed: boolean }>({ entries, collapsed })
  const progressRef = useRef(0)

  dataRef.current = { entries, collapsed }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    let width = 0
    let height = 0

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = Math.max(320, rect.width)
      height = Math.max(140, rect.height)
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = (time: number) => {
      const { entries: list, collapsed: isCollapsed } = dataRef.current
      progressRef.current += ((isCollapsed ? 1 : 0) - progressRef.current) * 0.07
      const progress = progressRef.current

      context.clearRect(0, 0, width, height)
      const middle = height / 2
      const maxAmplitude = height * 0.36
      const seconds = time / 1000

      context.strokeStyle = 'rgba(120, 160, 180, 0.09)'
      context.lineWidth = 1
      for (let index = 1; index < 6; index += 1) {
        const x = (width / 6) * index
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, height)
        context.stroke()
      }
      for (let index = 1; index < 4; index += 1) {
        const y = (height / 4) * index
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(width, y)
        context.stroke()
      }

      context.strokeStyle = 'rgba(79, 227, 208, 0.22)'
      context.setLineDash([3, 6])
      context.beginPath()
      context.moveTo(0, middle)
      context.lineTo(width, middle)
      context.stroke()
      context.setLineDash([])

      const dominant = [...list].sort((a, b) => b.share - a.share)[0]
      const steps = 220

      for (const entry of list) {
        const phase = hashPhase(entry.id)
        const frequency = 1.6 + ((phase % 1.2) * 1.8)
        const speed = 0.5 + (phase % 0.9)
        const dampen = entry.id === dominant?.id ? 1 : 1 - progress
        const amplitude = maxAmplitude * entry.share * 2.6 * dampen
        if (amplitude < 0.4) continue

        context.beginPath()
        for (let step = 0; step <= steps; step += 1) {
          const x = (width / steps) * step
          const y = middle + amplitude * Math.sin((x / width) * frequency * Math.PI * 2 + seconds * speed + phase)
          if (step === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.strokeStyle = entry.active ? `${entry.accent}cc` : `${entry.accent}55`
        context.lineWidth = entry.id === dominant?.id ? 2 : 1.4
        context.stroke()
      }

      context.beginPath()
      for (let step = 0; step <= steps * 2; step += 1) {
        const x = (width / (steps * 2)) * step
        let sum = 0
        for (const entry of list) {
          const phase = hashPhase(entry.id)
          const frequency = 1.6 + ((phase % 1.2) * 1.8)
          const speed = 0.5 + (phase % 0.9)
          const dampen = entry.id === dominant?.id ? 1 : 1 - progress
          sum += entry.share * 2.6 * dampen * Math.sin((x / width) * frequency * Math.PI * 2 + seconds * speed + phase)
        }
        const y = middle + maxAmplitude * sum
        if (step === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.strokeStyle = '#4fe3d0'
      context.lineWidth = 2.6
      context.shadowColor = 'rgba(79, 227, 208, 0.55)'
      context.shadowBlur = 14
      context.stroke()
      context.shadowBlur = 0

      frame = window.requestAnimationFrame(draw)
    }

    frame = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="field">
      <div className="field__head">
        <span className="label">Superpositionsfeld</span>
        <span className="field__legend">
          {entries.length === 0
            ? 'keine Kanäle'
            : `${entries.length} Wellen · Summenkurve als Kollapsvorschau`}
        </span>
      </div>
      <canvas ref={canvasRef} className="field__canvas" aria-label="Superpositionsfeld der Modellausgaben" />
    </div>
  )
}