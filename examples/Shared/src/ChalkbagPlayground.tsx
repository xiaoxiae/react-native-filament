import * as React from 'react'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  Model,
  Skybox,
  type Float3,
} from 'react-native-filament'

import { holds as allHolds, routes, wallGlb, skyStrongKtx, skyChalkKtx } from './chalkbag/wallData'

// How many holds to load (serial native loader — keep modest for now).
const HOLD_LIMIT = 12
const holds = allHolds.slice(0, HOLD_LIMIT)

type SkyMode = 'strong' | 'chalk' | 'flat' | 'none'
const SKY_ORDER: SkyMode[] = ['strong', 'chalk', 'flat', 'none']

// auto-frame camera from a set of holds: centroid + average normal, distance from spread
function frameHolds(set: typeof allHolds, pad: number): { position: Float3; target: Float3 } {
  const n = set.length || 1
  const centroid: Float3 = [0, 0, 0]
  const avgNormal: Float3 = [0, 0, 0]
  for (const h of set) {
    for (let i = 0; i < 3; i++) {
      centroid[i] += h.center[i] / n
      avgNormal[i] += h.normal[i] / n
    }
  }
  let radius = 0.5
  for (const h of set) {
    radius = Math.max(
      radius,
      Math.hypot(h.center[0] - centroid[0], h.center[1] - centroid[1], h.center[2] - centroid[2])
    )
  }
  const nl = Math.hypot(avgNormal[0], avgNormal[1], avgNormal[2]) || 1
  const dir: Float3 = [avgNormal[0] / nl, avgNormal[1] / nl, avgNormal[2] / nl]
  const dist = radius * pad + 1.5
  return {
    position: [centroid[0] + dir[0] * dist, centroid[1] + dir[1] * dist, centroid[2] + dir[2] * dist],
    target: centroid,
  }
}

function SkyboxFor({ mode }: { mode: SkyMode }) {
  switch (mode) {
    case 'strong':
      return <Skybox source={skyStrongKtx} showSun={false} />
    case 'chalk':
      return <Skybox source={skyChalkKtx} showSun={false} />
    case 'flat':
      return <Skybox colorInHex="#c8d0d8" showSun={false} />
    case 'none':
      return null
  }
}

function Renderer() {
  const [sky, setSky] = useState<SkyMode>('strong')
  const [showWall, setShowWall] = useState(true)
  const [routeIdx, setRouteIdx] = useState(-1) // -1 = overview (all loaded holds)

  // camera frames either all loaded holds (overview) or the selected route's loaded holds
  const { position, target } = useMemo(() => {
    if (routeIdx >= 0 && routes[routeIdx]) {
      const ids = new Set(routes[routeIdx].holdIds)
      const subset = holds.filter((h) => ids.has(h.id))
      if (subset.length) return frameHolds(subset, 2.2)
    }
    return frameHolds(holds, 1.8)
  }, [routeIdx])

  const cycleSky = () => setSky((s) => SKY_ORDER[(SKY_ORDER.indexOf(s) + 1) % SKY_ORDER.length])
  const cycleRoute = () => setRouteIdx((i) => (i + 1 >= routes.length ? -1 : i + 1))

  return (
    <View style={styles.root}>
      <FilamentView style={styles.view} enableTransparentRendering={true}>
        <Camera cameraPosition={position} cameraTarget={target} />
        <DefaultLight />
        <SkyboxFor mode={sky} />

        {showWall && <Model source={wallGlb} />}
        {holds.map((h) => (
          <Model key={h.id} source={h.glb} />
        ))}
      </FilamentView>

      <View style={styles.bar}>
        <Btn label={`Sky: ${sky}`} onPress={cycleSky} />
        <Btn label={`Wall: ${showWall ? 'on' : 'off'}`} onPress={() => setShowWall((w) => !w)} />
        <Btn
          label={routeIdx < 0 ? 'Route: all' : `Route: ${routes[routeIdx]?.name ?? routeIdx}`}
          onPress={cycleRoute}
        />
      </View>
    </View>
  )
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export function ChalkbagPlayground() {
  return (
    <FilamentScene>
      <Renderer />
    </FilamentScene>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  view: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 48,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  btn: {
    backgroundColor: 'rgba(20,24,32,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: 'white', fontSize: 14, fontWeight: '600' },
})
