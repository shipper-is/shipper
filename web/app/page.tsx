import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Personas } from "@/components/personas";
import { Workflow } from "@/components/workflow";

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <div className="border-t border-white/20" />
      <Personas />
      <div className="border-t border-white/20" />
      <Workflow />
      <div className="border-t border-white/20" />
      <Footer />
    </main>
  );
}
