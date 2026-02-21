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
      <section className="w-full bg-[#263f70] text-white">
      <div className="mx-auto flex min-h-[72vh] w-full max-w-[1400px] flex-col items-center justify-center gap-10 px-5 py-14 md:px-8 lg:flex-row lg:gap-16 lg:px-14">
        <div className="relative w-full max-w-[760px]">
          <p className="pointer-events-none absolute left-0 top-0 text-[112px] font-black leading-none text-white/12 sm:text-[170px] md:text-[220px]">
            404
          </p>
          <div className="relative pt-16 sm:pt-24 md:pt-32">
            <Image
              src="/error-404.svg"
              alt="Broken down car illustration"
              width={820}
              height={420}
              priority
              className="h-auto w-full"
            />
          </div>
        </div>

        <div className="w-full max-w-[500px]">
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
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
