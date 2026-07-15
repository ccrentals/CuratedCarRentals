import * as Linking from "expo-linking";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { Button, Card, Field, Notice, PageIntro, Screen } from "@/components/primitives";
import { colors } from "@/constants/theme";
import { contact } from "@/data/catalog";

async function open(url: string) {
  try { await Linking.openURL(url); } catch { Alert.alert("Unable to open", "This action is not available on this device."); }
}

export default function ContactScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sendEmail = () => {
    if (!name.trim() || !email.includes("@") || message.trim().length < 10) return setError("Add your name, a valid email and a short message.");
    setError("");
    const subject = encodeURIComponent(`App inquiry from ${name.trim()}`);
    const body = encodeURIComponent(`${message.trim()}\n\nReply to: ${email.trim()}`);
    void open(`mailto:${contact.email}?subject=${subject}&body=${body}`);
  };

  return (
    <Screen>
      <PageIntro eyebrow="Local support" title="Get in Touch" description="Reach out for booking questions, airport pickup help, vehicle guidance or longer-rental options." />
      <Card>
        <Text style={styles.title}>Call or WhatsApp</Text>
        <Text style={styles.address}>{contact.address}</Text>
        <Button label={`Call ${contact.phones[0]}`} onPress={() => void open("tel:+18763797163")} />
        <Button label="Open WhatsApp" onPress={() => void open(contact.whatsapp)} secondary />
        <Button label={`Email ${contact.email}`} onPress={() => void open(`mailto:${contact.email}`)} secondary />
      </Card>
      <Card>
        <Text style={styles.title}>Send a message</Text>
        <Text style={styles.help}>Share your dates, pickup area and preferred vehicle so the team can guide you quickly.</Text>
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Message" value={message} onChangeText={setMessage} multiline numberOfLines={5} style={styles.message} />
        <Button label="Prepare email" onPress={sendEmail} />
        {error ? <Notice error>{error}</Notice> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  address: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 10 },
  help: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 8 },
  message: { minHeight: 120, textAlignVertical: "top" },
});
