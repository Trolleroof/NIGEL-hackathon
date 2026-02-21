'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'

export default function Home() {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="tac-bg" style={{
      minHeight: '100vh', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
        <div className="font-mono" style={{
          fontSize: '10px', color: '#c03030',
          letterSpacing: '0.3em', marginBottom: '16px',
          textTransform: 'uppercase',
        }}>
          Incident Command System // v1.0
        </div>
        <h1 className="font-display" style={{
          fontSize: 'clamp(48px, 8vw, 88px)', fontWeight: 900,
          color: '#fff', letterSpacing: '0.12em', lineHeight: 1, margin: 0,
        }}>
          NIGEL
        </h1>
  
        <div className="font-mono" style={{
          fontSize: '11px', color: '#888', marginTop: '20px', letterSpacing: '0.15em',
        }}>
          {time || '00:00:00'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { href: '/dispatcher', label: 'DISPATCHER', sub: 'COMMAND CENTER', note: 'LAPTOP' },
          { href: '/firefighter', label: 'FIREFIGHTER', sub: 'UNIT FF1', note: 'PHONE / TABLET' },
        ].map(({ href, label, sub, note }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="panel" style={{
              width: '220px', padding: '28px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s', textAlign: 'center',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = '#ff3131'
              el.style.boxShadow = '0 0 20px rgba(255,49,49,0.25)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = '#1a1a1a'
              el.style.boxShadow = 'none'
            }}>
              <div className="font-display" style={{
                fontSize: '15px', fontWeight: 700, color: '#ffffff',
                letterSpacing: '0.12em', marginBottom: '8px',
              }}>
                {label}
              </div>
              <div className="font-mono" style={{ fontSize: '10px', color: '#a0a0a0', letterSpacing: '0.1em' }}>
                {sub}
              </div>
              <div className="font-mono" style={{
                fontSize: '9px', color: '#c03030', marginTop: '16px',
                letterSpacing: '0.15em',
              }}>
                → {note}
              </div>
            </div>
          </Link>
        ))}
      </div>

    </div>
  )
}
