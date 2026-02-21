'use client'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const FLOOR_H = 3.5
const LERP_T = 0.1

// ─── Building registry ────────────────────────────────────────────────
interface Building {
  id: string
  label: string
  name: string
  ref: string | null
  affiliation: string | null
  address: string
  url: string
}

const BUILDINGS: Building[] = [
  {
    id: 'cse',
    label: 'CSE Building',
    name: 'Computer Science & Engineering',
    ref: 'EBU3b',
    affiliation: 'Jacobs School of Engineering',
    address: '9500 Gilman Dr, La Jolla, CA 92093',
    url: '/data/cse.geojson',
  },
  {
    id: 'student-services',
    label: 'Student Services Center',
    name: 'Student Services Center',
    ref: 'SSC',
    affiliation: null,
    address: '9500 Gilman Dr, La Jolla, CA 92093',
    url: '/data/student-services.geojson',
  },
]

// ─── Web Mercator projection (EPSG:3857) ──────────────────────────────
function toMercator(lon: number, lat: number): [number, number] {
  const R = 6378137
  const x = (lon * Math.PI / 180) * R
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 360))) * R
  return [x, y]
}

function ringToLocal(outerRing: [number, number][]) {
  const [ox, oy] = toMercator(outerRing[0][0], outerRing[0][1])
  const vec2s = outerRing.map(([lon, lat]) => {
    const [mx, my] = toMercator(lon, lat)
    return new THREE.Vector2(mx - ox, my - oy)
  })
  const shape = new THREE.Shape(vec2s.slice(0, -1))
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

// ─── Dispose all Three.js objects in a group ──────────────────────────
function disposeGroup(group: THREE.Group) {
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh || (obj as THREE.Line).isLine) {
      mesh.geometry?.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose())
      } else {
        (mesh.material as THREE.Material)?.dispose()
      }
    }
  })
}

// ─── ThreeScene component ─────────────────────────────────────────────
export function ThreeScene() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState('cse')
  const [level, setLevel] = useState(0)
  const [availableLevels, setAvailableLevels] = useState<number[]>([0])
  const [error, setError] = useState<string | null>(null)

  const levelRef = useRef(level)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const buildingGroupRef = useRef<THREE.Group | null>(null)

  const floorSlabsRef = useRef<Map<number, THREE.Mesh>>(new Map())
  const floorLinesRef = useRef<Map<number, THREE.Line>>(new Map())
  const targetSlabOpacRef = useRef<Map<number, number>>(new Map())
  const targetLineOpacRef = useRef<Map<number, number>>(new Map())
  const targetLineColorRef = useRef<Map<number, THREE.Color>>(new Map())
  const cameraTargetYRef = useRef(FLOOR_H / 2)

  // ── Level change: set animation targets ──
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

  // ── Scene setup — runs once on mount ──
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let cancelled = false
    const animId = { current: 0 }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 5000)
    camera.position.set(0, 60, 80)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

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

      floorSlabsRef.current.forEach((mesh, lvl) => {
        const mat = mesh.material as THREE.MeshBasicMaterial
        const target = targetSlabOpacRef.current.get(lvl)
        if (target !== undefined && Math.abs(mat.opacity - target) > 0.001) {
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, LERP_T)
          mat.needsUpdate = true
        }
      })

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
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      floorSlabsRef.current.clear()
      floorLinesRef.current.clear()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // ── Building load — re-runs whenever the selected building changes ──
  useEffect(() => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!scene || !camera || !controls) return

    let cancelled = false

    // Tear down previous building geometry
    if (buildingGroupRef.current) {
      disposeGroup(buildingGroupRef.current)
      scene.remove(buildingGroupRef.current)
      buildingGroupRef.current = null
    }
    floorSlabsRef.current.clear()
    floorLinesRef.current.clear()
    targetSlabOpacRef.current.clear()
    targetLineOpacRef.current.clear()
    targetLineColorRef.current.clear()

    setLevel(0)
    levelRef.current = 0
    setError(null)

    const building = BUILDINGS.find(b => b.id === selectedBuildingId)!

    async function load() {
      try {
        const res = await fetch(building.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const geojson = await res.json()
        if (cancelled) return

        const feature = geojson.features?.[0]
        if (!feature || feature.geometry?.type !== 'Polygon') throw new Error('No Polygon feature')

        // Parse floor levels — fall back to building:levels if no level property
        const levelStr: string | undefined = feature.properties?.level
        let levels: number[]
        if (levelStr) {
          levels = levelStr.split(';').map(Number).sort((a, b) => a - b)
        } else {
          const count = parseInt(feature.properties?.['building:levels'] ?? '1', 10)
          levels = Array.from({ length: count }, (_, i) => i)
        }
        if (!cancelled) setAvailableLevels(levels)
        if (cancelled) return

        const outerRing: [number, number][] = feature.geometry.coordinates[0]
        const { shape, linePoints } = ringToLocal(outerRing)

        const minLvl = Math.min(...levels)
        const maxLvl = Math.max(...levels)
        const totalH = (maxLvl - minLvl + 1) * FLOOR_H

        const group = new THREE.Group()

        // Full-height shell
        const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: totalH, bevelEnabled: false })

        const shellSolid = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
          color: 0x220808, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
        }))
        shellSolid.rotation.x = -Math.PI / 2
        shellSolid.position.y = minLvl * FLOOR_H
        group.add(shellSolid)

        const shellWire = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
          color: 0xff4444, wireframe: true, transparent: true, opacity: 0.18,
        }))
        shellWire.rotation.x = -Math.PI / 2
        shellWire.position.y = minLvl * FLOOR_H
        group.add(shellWire)

        // Per-floor slabs + outlines
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
          group.add(slab)
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
          group.add(line)
          lines.set(lvl, line)

          targetSlabOpacRef.current.set(lvl, isActive ? 0.45 : 0.03)
          targetLineOpacRef.current.set(lvl, isActive ? 1.0 : 0.12)
          targetLineColorRef.current.set(lvl, new THREE.Color(isActive ? 0xff6666 : 0x2a0a0a))
        }

        scene!.add(group)
        buildingGroupRef.current = group
        floorSlabsRef.current = slabs
        floorLinesRef.current = lines

        // Reposition camera to fit new building
        const box = new THREE.Box3().setFromObject(shellSolid)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.z)
        const dist = maxDim * 1.8
        camera!.position.set(center.x + dist * 0.5, levelRef.current * FLOOR_H + dist * 0.55, center.z + dist * 0.7)
        const initTargetY = levelRef.current * FLOOR_H + FLOOR_H / 2
        controls!.target.set(center.x, initTargetY, center.z)
        cameraTargetYRef.current = initTargetY
        controls!.update()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load building')
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedBuildingId])

  const selectedBuilding = BUILDINGS.find(b => b.id === selectedBuildingId)!

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Building selector — top right */}
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 2,
        display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'flex-end',
      }}>
        <span className="font-mono" style={{
          fontSize: '7px', color: '#333', letterSpacing: '0.12em', marginBottom: '4px',
        }}>BUILDING</span>
        {BUILDINGS.map(b => (
          <button
            key={b.id}
            onClick={() => setSelectedBuildingId(b.id)}
            className="font-mono"
            style={{
              background: 'transparent',
              border: 'none',
              borderRight: `2px solid ${b.id === selectedBuildingId ? '#ff6666' : '#1a1a1a'}`,
              color: b.id === selectedBuildingId ? '#ff6666' : '#2a2a2a',
              fontSize: '9px',
              padding: '2px 6px',
              cursor: 'pointer',
              textAlign: 'right',
              letterSpacing: '0.08em',
              outline: 'none',
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Floor level selector — top left */}
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
            {l < 0 ? `B${Math.abs(l)}` : l === 0 ? 'GF' : `L${l}`}
          </button>
        ))}
      </div>

      {/* Building info card — bottom left */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 2,
        borderLeft: '2px solid #2a0a0a', paddingLeft: '7px',
        display: 'flex', flexDirection: 'column', gap: '2px',
      }}>
        <span className="font-mono" style={{ fontSize: '9px', color: '#cc4444', letterSpacing: '0.1em', fontWeight: 'bold' }}>
          {selectedBuilding.name}
        </span>
        <span className="font-mono" style={{ fontSize: '7px', color: '#663333', letterSpacing: '0.08em' }}>
          {selectedBuilding.ref}{selectedBuilding.affiliation ? ` · ${selectedBuilding.affiliation}` : ''}
        </span>
        <span className="font-mono" style={{ fontSize: '7px', color: '#442222', letterSpacing: '0.06em' }}>
          {selectedBuilding.address}
        </span>
        <span className="font-mono" style={{ fontSize: '7px', color: '#2a1a1a', letterSpacing: '0.06em' }}>
          UC San Diego &nbsp;·&nbsp; {availableLevels.length} floors
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
