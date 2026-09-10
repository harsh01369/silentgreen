'use client';

/**
 * The Ledger.
 *
 * Two lit panels stand open like the pages of a book: on the left, an answer;
 * on the right, the source it was given. A luminous thread stitches every fact
 * that traces to the source across the gap between them. A fact that appears
 * nowhere is an amber ember on the left panel, joined to nothing, and it
 * flickers. One or two dim points are unproven.
 *
 * Slow on purpose: the failure this tool exists for is a quiet one.
 */

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'traced' | 'absent' | 'withheld';
const HUE: Record<Kind, THREE.Color> = {
  traced: new THREE.Color(0.22, 2.3, 1.3),
  absent: new THREE.Color(2.8, 0.9, 0.32),
  withheld: new THREE.Color(0.6, 0.63, 0.72),
};

// The two panels, hinged open toward the camera.
const GAP = 2.4; // half-distance between the inner edges
const TILT = 0.36; // radians each panel turns to face the camera
const PW = 3.0; // panel width
const PH = 4.6; // panel height

interface Atom {
  kind: Kind;
  /** local point on the left panel plane, before the panel transform */
  la: THREE.Vector2;
  /** local point on the right panel plane, if traced */
  lr: THREE.Vector2 | null;
  phase: number;
}

const leftMat = new THREE.Matrix4().makeRotationY(TILT).setPosition(-GAP, 0, 0);
const rightMat = new THREE.Matrix4().makeRotationY(-TILT).setPosition(GAP, 0, 0);

function onLeft(p: THREE.Vector2) {
  return new THREE.Vector3(p.x, p.y, 0.06).applyMatrix4(leftMat);
}
function onRight(p: THREE.Vector2) {
  return new THREE.Vector3(p.x, p.y, 0.06).applyMatrix4(rightMat);
}

function buildAtoms(): Atom[] {
  const rng = mulberry32(20260911);
  const out: Atom[] = [];
  const px = () => (rng() - 0.5) * (PW - 1.0);
  const py = () => (rng() - 0.5) * (PH - 1.0);
  let absent = 0;
  for (let i = 0; i < 9; i++) {
    const roll = rng();
    let kind: Kind = roll > 0.8 ? 'absent' : roll > 0.72 ? 'withheld' : 'traced';
    if (kind === 'absent' && absent >= 2) kind = 'traced';
    if (kind === 'absent') absent++;
    // pair traced atoms at a similar height, so threads read as calm links.
    // keep the source end away from the outer edge so a thread never shoots off.
    const ay = py();
    const rx = () => (rng() - 0.5) * (PW - 1.6);
    out.push({
      kind,
      la: new THREE.Vector2(px(), ay),
      lr: kind === 'traced' ? new THREE.Vector2(rx(), ay + (rng() - 0.5) * 0.8) : null,
      phase: rng() * Math.PI * 2,
    });
  }
  return out;
}

function glowTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** A lit panel with abstract lines of type on its face. */
function Panel({ side, tint, rim }: { side: 'left' | 'right'; tint: string; rim: string }) {
  const lines = useMemo(() => {
    const rng = mulberry32(side === 'left' ? 41 : 77);
    const arr: { y: number; w: number; x: number }[] = [];
    const right = PW / 2 - 0.32;
    for (let r = 0; r < 18; r++) {
      const y = PH / 2 - 0.4 - r * 0.24;
      let x = -PW / 2 + 0.32;
      const blocks = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < blocks; b++) {
        let w = 0.3 + rng() * 1.3;
        if (x + w > right) w = right - x;
        if (w < 0.18) break;
        arr.push({ y, w, x: x + w / 2 });
        x += w + 0.18;
        if (x >= right) break;
      }
    }
    return arr;
  }, [side]);

  const rot = side === 'left' ? TILT : -TILT;
  const pos: [number, number, number] = side === 'left' ? [-GAP, 0, 0] : [GAP, 0, 0];

  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <mesh>
        <boxGeometry args={[PW, PH, 0.12]} />
        <meshStandardMaterial color={tint} metalness={0.4} roughness={0.5} emissive={tint} emissiveIntensity={0.4} />
      </mesh>
      {/* glowing frame */}
      {(
        [
          [0, PH / 2, PW, 0.025],
          [0, -PH / 2, PW, 0.025],
          [-PW / 2, 0, 0.025, PH],
          [PW / 2, 0, 0.025, PH],
        ] as [number, number, number, number][]
      ).map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0.065]}>
          <boxGeometry args={[w, h, 0.02]} />
          <meshBasicMaterial color={rim} toneMapped={false} />
        </mesh>
      ))}
      {lines.map((l, i) => (
        <mesh key={i} position={[l.x, l.y, 0.065]}>
          <boxGeometry args={[l.w, 0.05, 0.01]} />
          <meshBasicMaterial color="#aab4c0" transparent opacity={0.62} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Thread({ from, to, phase }: { from: THREE.Vector3; to: THREE.Vector3; phase: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5);
    mid.z += 1.7 + Math.abs(from.y - to.y) * 0.15;
    mid.y += 0.15;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    return new THREE.TubeGeometry(curve, 48, 0.012, 7, false);
  }, [from, to]);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HUE.traced,
        transparent: true,
        opacity: 0.6,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  useFrame((st) => {
    if (ref.current) {
      const m = ref.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.5 + Math.sin(st.clock.elapsedTime * 0.7 + phase) * 0.2;
    }
  });
  return <mesh ref={ref} geometry={geom} material={mat} />;
}

function Node({ world, kind, phase, sprite, size }: { world: THREE.Vector3; kind: Kind; phase: number; sprite: THREE.Texture; size: number }) {
  const ref = useRef<THREE.Sprite>(null);
  useFrame((st) => {
    if (!ref.current) return;
    const t = st.clock.elapsedTime;
    if (kind === 'absent') {
      const f = 0.7 + Math.abs(Math.sin(t * 1.9 + phase)) * 0.55 + (Math.sin(t * 10 + phase) > 0.9 ? 0.45 : 0);
      ref.current.scale.setScalar(size * f);
    } else {
      ref.current.scale.setScalar(size * (0.9 + Math.sin(t * 0.8 + phase) * 0.1));
    }
  });
  return (
    <sprite ref={ref} position={world} scale={size}>
      <spriteMaterial map={sprite} color={HUE[kind]} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  );
}

function Field() {
  const atoms = useMemo(buildAtoms, []);
  const sprite = useMemo(glowTexture, []);
  const group = useRef<THREE.Group>(null);
  const { pointer } = useThree();

  const placed = useMemo(
    () =>
      atoms.map((a) => ({
        ...a,
        wa: onLeft(a.la),
        wr: a.lr ? onRight(a.lr) : null,
      })),
    [atoms],
  );

  useFrame((st, dt) => {
    if (!group.current) return;
    const t = st.clock.elapsedTime;
    group.current.rotation.y = Math.sin(t * 0.05) * 0.06;
    group.current.rotation.x = -0.03 + Math.sin(t * 0.042) * 0.02;
    const k = Math.min(1, dt * 2);
    group.current.position.x += (0.9 + pointer.x * 0.3 - group.current.position.x) * k;
    group.current.position.y += (pointer.y * 0.16 - group.current.position.y) * k;
  });

  return (
    <group ref={group} position={[0.9, 0, 0]}>
      <Panel side="left" tint="#1c242c" rim="#33b98a" />
      <Panel side="right" tint="#1a2622" rim="#3aa8c0" />
      {placed.map((a, i) => (
        <group key={i}>
          {a.wr && <Thread from={a.wa} to={a.wr} phase={a.phase} />}
          <Node world={a.wa} kind={a.kind} phase={a.phase} sprite={sprite} size={a.kind === 'absent' ? 0.36 : a.kind === 'withheld' ? 0.22 : 0.3} />
          {a.wr && <Node world={a.wr} kind="traced" phase={a.phase} sprite={sprite} size={0.2} />}
        </group>
      ))}
    </group>
  );
}

function Rig() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(-0.4, 0.5, 8.4);
    camera.lookAt(1.2, 0.1, 0);
  }, [camera]);
  return null;
}

export function LedgerScene({ active = true }: { active?: boolean }) {
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 40, near: 0.1, far: 40 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Rig />
      <fog attach="fog" args={['#0a0b0d', 9, 20]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[-6, 4, 9]} intensity={1.0} color="#dcefff" />
      <directionalLight position={[8, -1, 5]} intensity={0.35} color="#ffe0bd" />
      <pointLight position={[0, 0.5, 3.5]} intensity={16} distance={11} color="#8bf0cd" />
      <Suspense fallback={null}>
        <Field />
      </Suspense>
      {/* MSAA on the composer instead of a separate SMAA pass; chromatic
          aberration dropped. Two fewer full-screen passes per frame. */}
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.8} luminanceThreshold={0.32} luminanceSmoothing={0.5} mipmapBlur radius={0.6} height={320} />
        <Vignette eskil={false} offset={0.28} darkness={0.92} />
      </EffectComposer>
    </Canvas>
  );
}
