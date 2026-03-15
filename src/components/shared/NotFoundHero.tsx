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
    <>
      <style>{`
        [data-site-header],
        [data-site-footer],
        [data-admin-full-header],
        [data-admin-compact-header],
        [data-admin-sidebar],
        [data-admin-drawer] {
          display: none !important;
        }
      `}</style>
      <section className="relative min-h-screen w-full overflow-hidden bg-[#263f70] text-white">
        <div className="absolute inset-0">
          <Image
            src="/error-404.svg"
            alt="Broken down car illustration"
            fill
            priority
            sizes="100vw"
            className="object-fill object-center"
          />
        </div>

        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(38,63,112,0.08)_0%,rgba(38,63,112,0.18)_36%,rgba(38,63,112,0.82)_64%,rgba(38,63,112,0.95)_100%)]" />

        <p className="pointer-events-none absolute left-[4%] top-[12%] z-10 text-[112px] font-black leading-none text-white/12 sm:text-[170px] md:text-[220px] lg:text-[280px]">
          404
        </p>

        <div className="relative z-10 flex min-h-screen items-center justify-end px-5 py-14 md:px-8 lg:px-14">
          <div className="w-full max-w-[560px]">
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              There Seems To Be Trouble
              <br />
              Under The Hood
            </h1>
            <p className="mt-6 text-2xl font-medium text-white/50">404 - Page not found!</p>

            <div className="mt-8">
              <Link
                href={homeHref}
                className="inline-flex items-center justify-center rounded-lg bg-[#ffc711] px-10 py-3 text-2xl font-bold text-[#263f70] transition hover:bg-[#ffd44d]"
              >
                <span className="mr-3 text-xl leading-none">‹</span>
                {homeLabel}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
