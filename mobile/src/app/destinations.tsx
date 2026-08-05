import { Button, PageIntro, PhotoCard, Screen } from "@/components/primitives";
import { destinations } from "@/data/catalog";

export default function DestinationsScreen() {
  return (
    <Screen>
      <PageIntro eyebrow="Plan your route" title="Tourist Destinations" description="Discover beaches, mountains, rivers and historic landmarks across Jamaica." />
      {destinations.map((item) => <PhotoCard key={item.name} image={item.image} eyebrow={item.location} title={item.name} body={item.description} action={<Button label="Find the right vehicle" href="/(tabs)/fleet" secondary />} />)}
    </Screen>
  );
}
