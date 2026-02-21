'use client'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const FLOOR_H = 3.5 // metres per storey
const LERP_T = 0.1  // transition speed per frame (~0.5s to settle)

// ─── Web Mercator projection (EPSG:3857) ──────────────────────────────
function toMercator(lon: number, lat: number): [number, number] {
  const R = 6378137
  const x = (lon * Math.PI / 180) * R
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 360))) * R
  return [x, y]
}

// Convert outer ring -> local metre coords + THREE.Shape
function ringToLocal(outerRing: [number, number][]) {
  const [ox, oy] = toMercator(outerRing[0][0], outerRing[0][1])
  const vec2s = outerRing.map(([lon, lat]) => {
    const [mx, my] = toMercator(lon, lat)
    return new THREE.Vector2(mx - ox, my - oy)
  })
  const shape = new THREE.Shape(vec2s.slice(0, -1))
  // XZ outline points (rotation.x = -PI/2 maps shape-Y -> world-Z = -localY)
  const linePoints = vec2s.slice(0, -1).map(v => new THREE.Vector3(v.x, 0, -v.y))
  linePoints.push(linePoints[0].clone())
  return { shape, linePoints }
}

// ─── loadBuildingFootprint — standalone utility ───────────────────────
export async function loadBuildingFootprint(
  scene: THREE.Scene,
  { url, level = 0 }: { url: string; level?: number },
): Promise<THREE.Group | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    const geojson = await res.json()
    const feature = geojson.features?.[0]
    if (!feature || feature.geometry?.type !== 'Polygon') {
      console.warn('[loadBuildingFootprint] No Polygon feature')
      return null
    }
    const outerRing: [number, number][] = feature.geometry.coordinates[0]
    const { shape, linePoints } = ringToLocal(outerRing)

    const group = new THREE.Group()
    group.position.y = level * FLOOR_H
    scene.add(group)

    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
    group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff6666 })))

    const floorMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    )
    floorMesh.rotation.x = -Math.PI / 2
    group.add(floorMesh)

    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_H, bevelEnabled: false })
    ;[
      new THREE.MeshBasicMaterial({ color: 0x441111, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xff5555, wireframe: true, transparent: true, opacity: 0.7 }),
    ].forEach(mat => {
      const m = new THREE.Mesh(wallGeo, mat)
      m.rotation.x = -Math.PI / 2
      group.add(m)
    })

    return group
  } catch (err) {
    console.error('[loadBuildingFootprint]', err)
    return null
  }
}

// ─── ThreeScene component ─────────────────────────────────────────────
export function ThreeScene() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [level, setLevel] = useState(0)
  const [availableLevels, setAvailableLevels] = useState<number[]>([-1, 0, 1, 2, 3])
  const [error, setError] = useState<string | null>(null)

  const levelRef = useRef(level)
  const controlsRef = useRef<OrbitControls | null>(null)

  // Per-floor object refs
  const floorSlabsRef = useRef<Map<number, THREE.Mesh>>(new Map())
  const floorLinesRef = useRef<Map<number, THREE.Line>>(new Map())

  // Animation targets — written by level effect, read by animate loop
  const targetSlabOpacRef = useRef<Map<number, number>>(new Map())
  const targetLineOpacRef = useRef<Map<number, number>>(new Map())
  const targetLineColorRef = useRef<Map<number, THREE.Color>>(new Map())
  const cameraTargetYRef = useRef(FLOOR_H / 2)

  // ── Level change: update animation targets only ──
  useEffect(() => {
    levelRef.current = level

    floorSlabsRef.current.forEach((_, lvl) => {
      targetSlabOpacRef.current.set(lvl, lvl === level ? 0.45 : 0.03)
    })

    floorLinesRef.current.forEach((_, lvl) => {
      targetLineOpacRef.current.set(lvl, lvl === level ? 1.0 : 0.12)
      targetLineColorRef.current.set(lvl, new THREE.Color(lvl === level ? 0xff6666 : 0x2a0a0a))
    })

    cameraTargetYRef.current = level * FLOOR_H + FLOOR_H / 2
  }, [level])

  // ── Scene setup (runs once on mount) ──
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let cancelled = false
    const animId = { current: 0 }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0a)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 5000)
    camera.position.set(0, 60, 80)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controlsRef.current = controls
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 10
    controls.maxDistance = 300
    controls.maxPolarAngle = Math.PI / 2.05

    scene.add(new THREE.GridHelper(200, 20, 0x1a1a1a, 0x111111))
    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dl = new THREE.DirectionalLight(0xff6644, 0.6)
    dl.position.set(80, 200, 80)
    scene.add(dl)
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.3)
    dl2.position.set(-60, 100, -60)
    scene.add(dl2)

    // ── Fetch + build per-floor geometry ──
    async function init() {
      try {
        const res = await fetch('/data/cse.geojson')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const geojson = await res.json()

        const feature = geojson.features?.[0]
        if (!feature || feature.geometry?.type !== 'Polygon') throw new Error('No Polygon feature')

        const levelStr: string = feature.properties?.level ?? '0'
        const levels = levelStr.split(';').map(Number).sort((a, b) => a - b)
        if (!cancelled && levels.length > 0) setAvailableLevels(levels)
        if (cancelled) return

        const outerRing: [number, number][] = feature.geometry.coordinates[0]
        const { shape, linePoints } = ringToLocal(outerRing)

        const minLvl = Math.min(...levels)
        const maxLvl = Math.max(...levels)
        const totalH = (maxLvl - minLvl + 1) * FLOOR_H

        // ── Full-height building shell ──
        const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: totalH, bevelEnabled: false })

        const shellSolid = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
          color: 0x220808, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
        }))
        shellSolid.rotation.x = -Math.PI / 2
        shellSolid.position.y = minLvl * FLOOR_H
        scene.add(shellSolid)

        const shellWire = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
          color: 0xff4444, wireframe: true, transparent: true, opacity: 0.18,
        }))
        shellWire.rotation.x = -Math.PI / 2
        shellWire.position.y = minLvl * FLOOR_H
        scene.add(shellWire)

        // ── Per-floor slab + outline ──
        const slabs = new Map<number, THREE.Mesh>()
        const lines = new Map<number, THREE.Line>()

        for (const lvl of levels) {
          const yPos = lvl * FLOOR_H
          const isActive = lvl === levelRef.current

          const slab = new THREE.Mesh(
            new THREE.ShapeGeometry(shape),
            new THREE.MeshBasicMaterial({
              color: 0xff4444, transparent: true,
              opacity: isActive ? 0.45 : 0.03, side: THREE.DoubleSide,
            }),
          )
          slab.rotation.x = -Math.PI / 2
          slab.position.y = yPos
          scene.add(slab)
          slabs.set(lvl, slab)

          const leveledPoints = linePoints.map(p => new THREE.Vector3(p.x, yPos, p.z))
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(leveledPoints),
            new THREE.LineBasicMaterial({
              color: isActive ? 0xff6666 : 0x2a0a0a,
              transparent: true,
              opacity: isActive ? 1.0 : 0.12,
            }),
          )
          scene.add(line)
          lines.set(lvl, line)

          // Initialise animation targets to match starting state (no pop-in)
          targetSlabOpacRef.current.set(lvl, isActive ? 0.45 : 0.03)
          targetLineOpacRef.current.set(lvl, isActive ? 1.0 : 0.12)
          targetLineColorRef.current.set(lvl, new THREE.Color(isActive ? 0xff6666 : 0x2a0a0a))
        }

        floorSlabsRef.current = slabs
        floorLinesRef.current = lines

        // ── Auto-center camera ──
        const box = new THREE.Box3().setFromObject(shellSolid)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.z)
        const dist = maxDim * 1.8
        camera.position.set(center.x + dist * 0.5, levelRef.current * FLOOR_H + dist * 0.55, center.z + dist * 0.7)
        const initTargetY = levelRef.current * FLOOR_H + FLOOR_H / 2
        controls.target.set(center.x, initTargetY, center.z)
        cameraTargetYRef.current = initTargetY
        controls.update()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load building')
      }
    }

    init()

    const ro = new ResizeObserver(() => {
      if (!mount || cancelled) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    })
    ro.observe(mount)

    const animate = () => {
      if (cancelled) return
      animId.current = requestAnimationFrame(animate)

      // ── Lerp slab opacities ──
      floorSlabsRef.current.forEach((mesh, lvl) => {
        const mat = mesh.material as THREE.MeshBasicMaterial
        const target = targetSlabOpacRef.current.get(lvl)
        if (target !== undefined && Math.abs(mat.opacity - target) > 0.001) {
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, LERP_T)
          mat.needsUpdate = true
        }
      })

      // ── Lerp line opacities + colors ──
      floorLinesRef.current.forEach((line, lvl) => {
        const mat = line.material as THREE.LineBasicMaterial
        const targetOpac = targetLineOpacRef.current.get(lvl)
        const targetColor = targetLineColorRef.current.get(lvl)
        if (targetOpac !== undefined && Math.abs(mat.opacity - targetOpac) > 0.001) {
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpac, LERP_T)
          mat.needsUpdate = true
        }
        if (targetColor) {
          mat.color.lerp(targetColor, LERP_T)
          mat.needsUpdate = true
        }
      })

      // ── Lerp camera orbit target Y ──
      const ty = cameraTargetYRef.current
      if (Math.abs(controls.target.y - ty) > 0.001) {
        controls.target.y = THREE.MathUtils.lerp(controls.target.y, ty, LERP_T)
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelled = true
      cancelAnimationFrame(animId.current)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      controlsRef.current = null
      floorSlabsRef.current.clear()
      floorLinesRef.current.clear()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Floor level selector — vertical stack, highest floor on top */}
      <div style={{
        position: 'absolute', top: 28, left: 8, zIndex: 2,
        display: 'flex', flexDirection: 'column', gap: '1px',
      }}>
        <span className="font-mono" style={{
          fontSize: '7px', color: '#333', letterSpacing: '0.12em', marginBottom: '5px',
        }}>FLOOR</span>
        {[...availableLevels].reverse().map(l => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className="font-mono"
            style={{
              background: 'transparent',
              border: 'none',
              borderLeft: `2px solid ${l === level ? '#ff6666' : '#1a1a1a'}`,
              color: l === level ? '#ff6666' : '#2a2a2a',
              fontSize: '9px',
              padding: '2px 6px',
              cursor: 'pointer',
              textAlign: 'left',
              letterSpacing: '0.08em',
              outline: 'none',
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {l < 0 ? `B${Math.abs(l)}` : `L${l}`}
          </button>
        ))}
      </div>

      {/* Building label */}
      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 2 }}>
        <span className="font-mono" style={{ fontSize: '7px', color: '#1a1a1a', letterSpacing: '0.15em' }}>
          CSE BUILDING // EBU3B // UCSD
        </span>
      </div>

      {error && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
          background: '#0a0000', border: '1px solid #4d1010', padding: '3px 10px',
        }}>
          <span className="font-mono" style={{ fontSize: '8px', color: '#ff3131' }}>GEOJSON ERR: {error}</span>
        </div>
      )}
    </div>
  )
}
