import { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";

import { Button, Notice } from "@/components/primitives";
import { colors, radii } from "@/constants/theme";

export function SignaturePad({ onChange }: { onChange: (signatureDataUrl: string | null) => void }) {
  const canvasRef = useRef<View>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [responder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      setPaths((current) => [...current, `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`]);
      setSaved(false);
      onChange(null);
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      setPaths((current) => {
        const activePath = current.at(-1);
        if (!activePath) return current;
        return [...current.slice(0, -1), `${activePath} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`];
      });
    },
  }));

  const clear = () => {
    setPaths([]);
    setSaved(false);
    setError("");
    onChange(null);
  };

  const save = async () => {
    if (paths.length === 0 || !canvasRef.current) {
      setError("Draw your signature before saving it.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const signatureDataUrl = await captureRef(canvasRef, {
        format: "png",
        quality: 0.9,
        result: "data-uri",
      });
      onChange(signatureDataUrl);
      setSaved(true);
    } catch {
      setError("Unable to save the signature on this device. Clear it and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <Text style={styles.help}>Sign inside the box, then save the signature before confirming your reservation.</Text>
      <View ref={canvasRef} collapsable={false} style={styles.canvas} {...responder.panHandlers}>
        <Svg width="100%" height="100%">
          <Rect width="100%" height="100%" fill="#FFFFFF" />
          {paths.map((path, index) => <Path key={`${index}-${path.length}`} d={path} stroke={colors.navy} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
        </Svg>
        <View pointerEvents="none" style={styles.line} />
      </View>
      <View style={styles.actions}>
        <View style={styles.action}><Button label="Clear" onPress={clear} secondary /></View>
        <View style={styles.action}><Button label={saving ? "Saving…" : "Save signature"} onPress={() => void save()} disabled={saving} /></View>
      </View>
      {saved ? <Notice>Signature saved on this device.</Notice> : null}
      {error ? <Notice error>{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, fontSize: 13, lineHeight: 20, marginVertical: 12 },
  canvas: { height: 190, overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.white },
  line: { position: "absolute", left: 24, right: 24, bottom: 38, height: 1, backgroundColor: "#CBD5E1" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1 },
});
