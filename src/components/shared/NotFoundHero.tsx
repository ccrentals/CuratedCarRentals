import Image from "next/image";
import Link from "next/link";

type NotFoundHeroProps = {
  homeHref: string;
  homeLabel?: string;
};

export function NotFoundHero({
  homeHref,
  homeLabel = "Go Back",
}: NotFoundHeroProps) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[28px] bg-[#223a66] px-6 py-8 text-white shadow-xl md:px-10 md:py-12">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="relative">
            <p className="pointer-events-none absolute left-0 top-0 text-[92px] font-black leading-none text-white/12 sm:text-[140px]">
              404
            </p>
            <div className="relative pt-14 sm:pt-20">
              <Image
                src="/error-404.svg"
                alt="Broken down car illustration"
                width={707}
                height={400}
                priority
                className="h-auto w-full max-w-[560px]"
              />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
              There Seems To Be Trouble
              <br />
              Under The Hood
            </h1>
            <p className="mt-5 text-lg font-medium text-white/55">404 - Page not found!</p>

            <div className="mt-7">
              <Link
                href={homeHref}
                className="inline-flex items-center justify-center rounded-xl bg-[#ffc711] px-6 py-3 text-base font-bold text-[#223a66] transition hover:bg-[#ffcf3f]"
              >
                {homeLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
