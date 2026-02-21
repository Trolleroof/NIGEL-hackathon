'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

const MAP_WIDTH = 900
const MAP_HEIGHT = 500
const HALF_MAP_WIDTH = MAP_WIDTH / 2
const HALF_MAP_HEIGHT = MAP_HEIGHT / 2
const THREE_CDN_URL = 'https://esm.sh/three@0.181.1'
const ORBIT_CDN_URL = 'https://esm.sh/three@0.181.1/examples/jsm/controls/OrbitControls.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function canvasToWorld(position) {
  return {
    x: position.x - HALF_MAP_WIDTH,
    z: position.y - HALF_MAP_HEIGHT,
  }
}

function worldToCanvas(position) {
  return {
    x: clamp(position.x + HALF_MAP_WIDTH, 0, MAP_WIDTH),
    y: clamp(position.z + HALF_MAP_HEIGHT, 0, MAP_HEIGHT),
  }
}

export default function ThreeJsCloudPage() {
  const mountRef = useRef(null)
  const runtimeRef = useRef(null)
  const dragWaypointRef = useRef(false)
  const latestSceneStateRef = useRef({
    waypoint: null,
    firefighterPosition: { x: 435, y: 400 },
    breadcrumbs: [],
  })

  const [waypoint, setWaypoint] = useState(null)
  const [firefighterPosition, setFirefighterPosition] = useState({ x: 435, y: 400 })
  const [breadcrumbs, setBreadcrumbs] = useState([])
  const [statusText, setStatusText] = useState('Loading three.js modules...')
  const [loadError, setLoadError] = useState(null)
  const [isDraggingWaypoint, setIsDraggingWaypoint] = useState(false)
  const [cameraReadout, setCameraReadout] = useState({ distance: 0, azimuth: 0, elevation: 0 })
  const [isCompactLayout, setIsCompactLayout] = useState(false)

  const postWaypoint = useCallback(async (position) => {
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'dispatcher_places_waypoint', position }),
      })
    } catch {
      // Keep local UI responsive even if API update fails.
    }
  }, [])

  const clearWaypoint = useCallback(async () => {
    setWaypoint(null)
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'dispatcher_clears_waypoint' }),
      })
    } catch {
      // Keep local UI responsive even if API update fails.
    }
  }, [])

  const resetCamera = useCallback(() => {
    runtimeRef.current?.resetCamera?.()
  }, [])

  useEffect(() => {
    const onResize = () => {
      setIsCompactLayout(window.innerWidth < 1150)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let mounted = true
    const pollState = async () => {
      try {
        const res = await fetch('/api/state')
        if (!res.ok) return
        const data = await res.json()
        if (!mounted) return
        setFirefighterPosition(data.firefighterPosition ?? { x: 435, y: 400 })
        setBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [])
        if (!dragWaypointRef.current) setWaypoint(data.waypoint ?? null)
      } catch {
        // Poll errors are transient in this dashboard.
      }
    }

    void pollState()
    const id = window.setInterval(() => { void pollState() }, 320)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    latestSceneStateRef.current = { waypoint, firefighterPosition, breadcrumbs }
    runtimeRef.current?.syncScene?.(latestSceneStateRef.current)
  }, [waypoint, firefighterPosition, breadcrumbs])

  useEffect(() => {
    let disposed = false
    let frameId = 0
    let resizeObserver = null
    let removeDomListeners = () => {}
    let removeResizeListener = () => {}

    const init = async () => {
      const container = mountRef.current
      if (!container) return

      setLoadError(null)
      setStatusText('Loading three.js modules...')

      const threeModule = await import(/* webpackIgnore: true */ THREE_CDN_URL)
      const orbitModule = await import(/* webpackIgnore: true */ ORBIT_CDN_URL)
      if (disposed) return

      const THREE = threeModule
      const OrbitControls = orbitModule.OrbitControls
      if (!THREE?.Scene || !OrbitControls) {
        throw new Error('Unable to load three.js controls')
      }

      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#050505')
      scene.fog = new THREE.Fog('#050505', 420, 1650)

      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3500)
      camera.position.set(0, 380, 620)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      container.innerHTML = ''
      container.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.minDistance = 120
      controls.maxDistance = 1650
      controls.target.set(0, 0, 0)
      controls.update()

      const hemiLight = new THREE.HemisphereLight(0x888888, 0x111111, 1.1)
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.85)
      keyLight.position.set(120, 180, 80)
      scene.add(hemiLight)
      scene.add(keyLight)

      const grid = new THREE.GridHelper(MAP_WIDTH, 30, 0x333333, 0x1a1a1a)
      grid.position.y = 0.06
      scene.add(grid)

      const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT),
        new THREE.MeshBasicMaterial({
          color: '#0e0e0e',
          transparent: true,
          opacity: 0.58,
          side: THREE.DoubleSide,
        }),
      )
      floorMesh.rotation.x = -Math.PI / 2
      scene.add(floorMesh)

      const floorBorder = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT)),
        new THREE.LineBasicMaterial({ color: 0x2a2a2a }),
      )
      floorBorder.rotation.x = -Math.PI / 2
      floorBorder.position.y = 0.08
      scene.add(floorBorder)

      const cloudPointCount = 3600
      const cloudPositions = new Float32Array(cloudPointCount * 3)
      for (let i = 0; i < cloudPointCount; i += 1) {
        const px = (Math.random() - 0.5) * MAP_WIDTH
        const pz = (Math.random() - 0.5) * MAP_HEIGHT
        const py = 8 + Math.random() * 32 + Math.sin(px * 0.045) * 8 + Math.cos(pz * 0.043) * 6
        cloudPositions[i * 3] = px
        cloudPositions[i * 3 + 1] = py
        cloudPositions[i * 3 + 2] = pz
      }
      const cloudGeometry = new THREE.BufferGeometry()
      cloudGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cloudPositions, 3))
      const cloudMaterial = new THREE.PointsMaterial({
        color: 0x6a6a6a,
        size: 2.1,
        sizeAttenuation: true,
        opacity: 0.72,
        transparent: true,
      })
      const cloudPoints = new THREE.Points(cloudGeometry, cloudMaterial)
      scene.add(cloudPoints)

      const breadcrumbGeometry = new THREE.BufferGeometry()
      const breadcrumbMaterial = new THREE.PointsMaterial({
        color: 0xff3131,
        size: 2.6,
        transparent: true,
        opacity: 0.55,
      })
      const breadcrumbPoints = new THREE.Points(breadcrumbGeometry, breadcrumbMaterial)
      breadcrumbPoints.position.y = 1.2
      scene.add(breadcrumbPoints)

      const firefighterMarker = new THREE.Mesh(
        new THREE.SphereGeometry(7, 24, 24),
        new THREE.MeshStandardMaterial({
          color: 0xff3131,
          emissive: 0x3f0000,
          roughness: 0.28,
          metalness: 0.15,
        }),
      )
      scene.add(firefighterMarker)

      const waypointGroup = new THREE.Group()
      const waypointCore = new THREE.Mesh(
        new THREE.SphereGeometry(6, 24, 24),
        new THREE.MeshStandardMaterial({
          color: 0xff3131,
          emissive: 0x450000,
          roughness: 0.22,
          metalness: 0.08,
        }),
      )
      const waypointRing = new THREE.Mesh(
        new THREE.TorusGeometry(12, 1.5, 8, 48),
        new THREE.MeshBasicMaterial({
          color: 0xff3131,
          transparent: true,
          opacity: 0.8,
        }),
      )
      waypointRing.rotation.x = Math.PI / 2
      waypointGroup.add(waypointCore)
      waypointGroup.add(waypointRing)
      waypointGroup.visible = false
      scene.add(waypointGroup)

      const syncScene = (nextState) => {
        const ffCanvas = nextState.firefighterPosition ?? { x: 435, y: 400 }
        const ffWorld = canvasToWorld(ffCanvas)
        firefighterMarker.position.set(ffWorld.x, 7, ffWorld.z)

        if (nextState.waypoint) {
          const wpWorld = canvasToWorld(nextState.waypoint)
          waypointGroup.visible = true
          waypointGroup.position.set(wpWorld.x, waypointGroup.position.y || 4, wpWorld.z)
        } else if (!dragWaypointRef.current) {
          waypointGroup.visible = false
        }

        const trail = Array.isArray(nextState.breadcrumbs) ? nextState.breadcrumbs : []
        const trailPositions = new Float32Array(trail.length * 3)
        for (let i = 0; i < trail.length; i += 1) {
          const p = canvasToWorld(trail[i])
          trailPositions[i * 3] = p.x
          trailPositions[i * 3 + 1] = 1.2
          trailPositions[i * 3 + 2] = p.z
        }
        breadcrumbGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3))
      }

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const dragPoint = new THREE.Vector3()
      let dragging = false

      const setPointerFromEvent = (event) => {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      }

      const applyWaypointFromWorld = (worldPoint) => {
        const clampedWorld = {
          x: clamp(worldPoint.x, -HALF_MAP_WIDTH, HALF_MAP_WIDTH),
          z: clamp(worldPoint.z, -HALF_MAP_HEIGHT, HALF_MAP_HEIGHT),
        }
        waypointGroup.visible = true
        waypointGroup.position.set(clampedWorld.x, 4, clampedWorld.z)
        const waypointCanvas = worldToCanvas(clampedWorld)
        setWaypoint(waypointCanvas)
        return waypointCanvas
      }

      const onPointerDown = (event) => {
        if (!waypointGroup.visible) return
        setPointerFromEvent(event)
        raycaster.setFromCamera(pointer, camera)
        const hitWaypoint = raycaster.intersectObject(waypointCore, false).length > 0
        if (!hitWaypoint) return
        dragging = true
        dragWaypointRef.current = true
        setIsDraggingWaypoint(true)
        controls.enabled = false
        renderer.domElement.style.cursor = 'grabbing'
        event.preventDefault()
      }

      const onPointerMove = (event) => {
        setPointerFromEvent(event)
        raycaster.setFromCamera(pointer, camera)

        if (dragging) {
          if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            applyWaypointFromWorld(dragPoint)
          }
          return
        }

        const hitWaypoint = waypointGroup.visible && raycaster.intersectObject(waypointCore, false).length > 0
        renderer.domElement.style.cursor = hitWaypoint ? 'grab' : 'default'
      }

      const onPointerUp = () => {
        if (!dragging) return
        dragging = false
        controls.enabled = true
        dragWaypointRef.current = false
        setIsDraggingWaypoint(false)
        renderer.domElement.style.cursor = 'default'
        const updatedWaypoint = worldToCanvas(waypointGroup.position)
        setWaypoint(updatedWaypoint)
        void postWaypoint(updatedWaypoint)
      }

      const onDoubleClick = (event) => {
        setPointerFromEvent(event)
        raycaster.setFromCamera(pointer, camera)
        const hits = raycaster.intersectObject(floorMesh, false)
        if (!hits.length) return
        const placedWaypoint = applyWaypointFromWorld(hits[0].point)
        void postWaypoint(placedWaypoint)
      }

      const onContextMenu = (event) => {
        event.preventDefault()
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerup', onPointerUp)
      renderer.domElement.addEventListener('pointerleave', onPointerUp)
      renderer.domElement.addEventListener('dblclick', onDoubleClick)
      renderer.domElement.addEventListener('contextmenu', onContextMenu)
      removeDomListeners = () => {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        renderer.domElement.removeEventListener('pointerleave', onPointerUp)
        renderer.domElement.removeEventListener('dblclick', onDoubleClick)
        renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      }

      const resize = () => {
        const width = Math.max(container.clientWidth, 1)
        const height = Math.max(container.clientHeight, 1)
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }

      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
      window.addEventListener('resize', resize)
      removeResizeListener = () => window.removeEventListener('resize', resize)

      let lastHudUpdate = 0
      const animate = () => {
        frameId = requestAnimationFrame(animate)
        controls.update()

        const now = performance.now()
        if (waypointGroup.visible) {
          waypointGroup.position.y = 4 + Math.sin(now * 0.01) * 0.9
          waypointRing.material.opacity = 0.55 + 0.3 * Math.sin(now * 0.009)
        }

        if (now - lastHudUpdate > 130) {
          const offset = camera.position.clone().sub(controls.target)
          const distance = offset.length()
          const azimuth = Math.atan2(offset.x, offset.z) * (180 / Math.PI)
          const elevation = Math.atan2(
            offset.y,
            Math.sqrt(offset.x * offset.x + offset.z * offset.z),
          ) * (180 / Math.PI)
          setCameraReadout({
            distance: Number(distance.toFixed(1)),
            azimuth: Number(azimuth.toFixed(1)),
            elevation: Number(elevation.toFixed(1)),
          })
          lastHudUpdate = now
        }

        renderer.render(scene, camera)
      }
      animate()

      runtimeRef.current = {
        syncScene,
        resetCamera: () => {
          camera.position.set(0, 380, 620)
          controls.target.set(0, 0, 0)
          controls.update()
        },
        dispose: () => {
          controls.dispose()
          renderer.dispose()
          cloudGeometry.dispose()
          cloudMaterial.dispose()
          breadcrumbGeometry.dispose()
          breadcrumbMaterial.dispose()
          floorMesh.geometry.dispose()
          floorMesh.material.dispose()
          floorBorder.geometry.dispose()
          floorBorder.material.dispose()
          waypointCore.geometry.dispose()
          waypointCore.material.dispose()
          waypointRing.geometry.dispose()
          waypointRing.material.dispose()
          firefighterMarker.geometry.dispose()
          firefighterMarker.material.dispose()
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement)
          }
        },
      }

      syncScene(latestSceneStateRef.current)
      setStatusText('three.js cloud online')
      setLoadError(null)
    }

    void init().catch(() => {
      if (disposed) return
      setStatusText('three.js load failed')
      setLoadError('Could not load three.js from CDN in this environment.')
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      removeDomListeners()
      removeResizeListener()
      resizeObserver?.disconnect()
      runtimeRef.current?.dispose?.()
      runtimeRef.current = null
    }
  }, [postWaypoint])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        height: isCompactLayout ? 'auto' : '42px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: isCompactLayout ? 'stretch' : 'center',
        justifyContent: 'space-between',
        flexDirection: isCompactLayout ? 'column' : 'row',
        gap: isCompactLayout ? '8px' : 0,
        padding: isCompactLayout ? '8px 10px' : '0 16px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span className="font-display" style={{ fontSize: '12px', letterSpacing: '0.14em' }}>
            THREE.JS CLOUD
          </span>
          <span className="font-mono" style={{ fontSize: '8px', color: '#4d4d4d', letterSpacing: '0.08em' }}>
            {statusText.toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="font-mono"
            onClick={resetCamera}
            style={actionButtonStyle}
          >
            RESET VIEW
          </button>
          <button
            type="button"
            className="font-mono"
            onClick={() => void clearWaypoint()}
            style={actionButtonStyle}
          >
            CLEAR WAYPOINT
          </button>
          <Link href="/dispatcher" className="font-mono" style={actionButtonStyle}>
            BACK TO DISPATCHER
          </Link>
        </div>
      </div>

      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: isCompactLayout ? '1fr' : '1fr 280px',
        gap: '8px',
        padding: '8px',
        overflow: isCompactLayout ? 'auto' : 'hidden',
      }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <span>Point Cloud</span>
            <span className="font-mono" style={{ fontSize: '8px', color: '#4d4d4d' }}>
              {isDraggingWaypoint
                ? 'DRAGGING WAYPOINT'
                : waypoint
                  ? `WPT: (${Math.round(waypoint.x)}, ${Math.round(waypoint.y)})`
                  : 'NO WAYPOINT'}
            </span>
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <div ref={mountRef} style={{ position: 'absolute', inset: 0, background: '#050505' }} />
            <div style={{
              position: 'absolute',
              left: '10px',
              bottom: '10px',
              border: '1px solid #1a1a1a',
              background: 'rgba(0,0,0,0.68)',
              padding: '6px 8px',
            }}>
              <div className="font-mono" style={{ fontSize: '8px', color: '#9a9a9a', letterSpacing: '0.06em' }}>
                Double-click floor to place waypoint
              </div>
              <div className="font-mono" style={{ fontSize: '8px', color: '#9a9a9a', letterSpacing: '0.06em' }}>
                Drag red marker to reposition
              </div>
            </div>
            {loadError && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.8)',
                display: 'grid',
                placeItems: 'center',
                padding: '24px',
                textAlign: 'center',
              }}>
                <div className="font-mono" style={{ color: '#ff3131', fontSize: '10px', lineHeight: 1.6 }}>
                  {loadError}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div className="panel-header">Control Deck</div>
          <div style={{
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            minHeight: 0,
            overflowY: 'auto',
          }}>
            <Readout label="CAM DIST" value={cameraReadout.distance.toFixed(1)} />
            <Readout label="AZIMUTH" value={`${cameraReadout.azimuth.toFixed(1)}°`} />
            <Readout label="ELEVATION" value={`${cameraReadout.elevation.toFixed(1)}°`} />
            <Readout
              label="WAYPOINT"
              value={waypoint
                ? `${Math.round(waypoint.x)} / ${Math.round(waypoint.y)}`
                : '--'}
            />
            <Readout
              label="FIREFIGHTER"
              value={`${Math.round(firefighterPosition.x)} / ${Math.round(firefighterPosition.y)}`}
            />
            <Readout label="BREADCRUMBS" value={`${breadcrumbs.length}`} />

            <div style={{ borderTop: '1px solid #1a1a1a', marginTop: '4px', paddingTop: '8px' }}>
              <div className="font-mono" style={{ fontSize: '8px', color: '#7f7f7f', letterSpacing: '0.08em', marginBottom: '6px' }}>
                MOUSE CONTROLS
              </div>
              <div className="font-mono" style={hintStyle}>- Left drag: orbit</div>
              <div className="font-mono" style={hintStyle}>- Right drag: pan</div>
              <div className="font-mono" style={hintStyle}>- Wheel: zoom</div>
              <div className="font-mono" style={hintStyle}>- Double-click: place waypoint</div>
              <div className="font-mono" style={hintStyle}>- Drag waypoint: quick reposition</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const actionButtonStyle = {
  textDecoration: 'none',
  border: '1px solid #2a2a2a',
  color: '#ff3131',
  background: 'transparent',
  padding: '5px 9px',
  fontSize: '8px',
  letterSpacing: '0.1em',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const hintStyle = {
  fontSize: '8px',
  color: '#8a8a8a',
  letterSpacing: '0.05em',
  lineHeight: 1.7,
}

function Readout({ label, value }) {
  return (
    <div style={{
      border: '1px solid #1a1a1a',
      background: '#060606',
      padding: '7px 8px',
      display: 'flex',
      justifyContent: 'space-between',
      gap: '8px',
      alignItems: 'center',
    }}>
      <span className="font-mono" style={{ fontSize: '7px', color: '#666', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span className="font-mono" style={{ fontSize: '9px', color: '#d2d2d2', letterSpacing: '0.06em' }}>
        {value}
      </span>
    </div>
  )
}
