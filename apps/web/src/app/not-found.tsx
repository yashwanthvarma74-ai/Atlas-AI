import Link from 'next/link';

export default function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        <Link href="/">Go to the start page</Link>
      </p>
    </section>
  );
}
