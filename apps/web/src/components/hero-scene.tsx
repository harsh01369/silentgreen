'use client';

/**
 * The hero, in three dimensions.
 *
 * It draws what the product does. A plane of source material lies below. Above
 * it hang the atoms pulled out of an answer: figures, dates, names. Most are
 * tied by a taut line to a point in the source: grounded. A few float free and
 * glow amber: they appear nowhere in the material the model was given. One or
 * two are dim slate: unproven, the verdict this product refuses to dress up as
 * a pass.
 *
 * Slow on purpose. The failure this tool exists for is a quiet one.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Verdict = 'grounded' | 'ungrounded' | 'unproven';

const COLOR: Record<Verdict, THREE.Color> = {
  grounded: new THREE.Color('#7ff0c4'),
  ungrounded: new THREE.Color('#eaa25c'),
  unproven: new THREE.Color('#93a1b2'),
};

interface Atom {
  base: THREE.Vector3;
  anchor: THREE.Vector3 | null;
  verdict: Verdict;
  phase: number;
  drift: number;
}

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

function makeAtoms(count: number): Atom[] {
  const rng = mulberry32(20260910);
  const out: Atom[] = [];
  const PLANE_Y = -1.6;
  for (let i = 0; i < count; i++) {
    // Bias to the right and centre so the headline on the left stays clear.
    const x = -0.5 + rng() * 7.5;
    const y = 0.3 + rng() * 3.1;
    const z = -1.5 + rng() * 3;
    const roll = rng();
    const verdict: Verdict = roll > 0.83 ? 'ungrounded' : roll > 0.75 ? 'unproven' : 'grounded';
    out.push({
      base: new THREE.Vector3(x, y, z),
      anchor: verdict === 'grounded' ? new THREE.Vector3(x + (rng() - 0.5) * 0.4, PLANE_Y, z + (rng() - 0.5) * 0.4) : null,
      verdict,
      phase: rng() * Math.PI * 2,
      drift: 0.12 + rng() * 0.2,
    });
  }
  return out;
}

function glowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Field() {
  const atoms = useMemo(() => makeAtoms(30), []);
  const sprite = useMemo(glowTexture, []);
  const group = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const anchorRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  const grounded = useMemo(() => atoms.filter((a) => a.anchor), [atoms]);

  const geo = useMemo(() => {
    const positions = new Float32Array(atoms.length * 3);
    const colors = new Float32Array(atoms.length * 3);
    atoms.forEach((a, i) => {
      positions.set([a.base.x, a.base.y, a.base.z], i * 3);
      const col = COLOR[a.verdict];
      colors.set([col.r, col.g, col.b], i * 3);
    });
    const anchorPos = new Float32Array(grounded.length * 3);
    grounded.forEach((a, i) => anchorPos.set([a.anchor!.x, a.anchor!.y, a.anchor!.z], i * 3));
    const linePos = new Float32Array(grounded.length * 6);
    return { positions, colors, anchorPos, linePos };
  }, [atoms, grounded]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.03) * 0.16;
      group.current.position.x = state.pointer.x * 0.35 - 0.1;
      group.current.position.y = state.pointer.y * 0.18;
    }

    const pos = pointsRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (pos) {
      atoms.forEach((a, i) => {
        const sway = Math.sin(t * a.drift + a.phase);
        const bob = a.verdict === 'ungrounded' ? Math.sin(t * 0.9 + a.phase) * 0.1 : 0;
        pos.setXYZ(
          i,
          a.base.x + sway * 0.18,
          a.base.y + Math.cos(t * a.drift * 0.7 + a.phase) * 0.1 + bob,
          a.base.z + sway * 0.1,
        );
      });
      pos.needsUpdate = true;
    }

    const lpos = linesRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (lpos && pos) {
      grounded.forEach((a, i) => {
        const idx = atoms.indexOf(a);
        lpos.setXYZ(i * 2, pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        lpos.setXYZ(i * 2 + 1, a.anchor!.x, a.anchor!.y, a.anchor!.z);
      });
      lpos.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.5, -1.6, 0]}>
        <planeGeometry args={[30, 22]} />
        <meshBasicMaterial color="#0c141d" transparent opacity={0.7} />
      </mesh>
      <gridHelper args={[30, 30, '#22384a', '#16242f']} position={[1.5, -1.58, 0]} />

      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geo.linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#4aa588" transparent opacity={0.7} />
      </lineSegments>

      <points ref={anchorRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geo.anchorPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#7ff0c4"
          map={sprite}
          size={0.28}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geo.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[geo.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          map={sprite}
          size={0.55}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function HeroScene() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.0, 8.6], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      style={{ position: 'absolute', inset: 0 }}
      onCreated={({ camera }) => camera.lookAt(1.4, 0.9, 0)}
    >
      <fog attach="fog" args={['#0a0e14', 8, 19]} />
      <ambientLight intensity={0.4} />
      <Field />
    </Canvas>
  );
}
