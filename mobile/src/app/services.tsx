import { Button, PageIntro, PhotoCard, Screen } from "@/components/primitives";
import { services } from "@/data/catalog";

export default function ServicesScreen() {
  return (
    <Screen>
      <PageIntro eyebrow="Beyond the rental" title="Our Services" description="Thoughtful extras designed to make your Jamaican journey comfortable from arrival to return." />
      {services.map((service) => <PhotoCard key={service.id} image={service.image} title={service.title} body={service.description} action={<Button label="Ask about this service" href="/contact" secondary />} />)}
    </Screen>
  );
}
