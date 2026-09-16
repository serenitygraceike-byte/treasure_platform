export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Treasury Platform</h1>
      <p className="mt-2 text-neutral-600">
        See <code>/api/health</code> and <code>/api/ready</code>, or{" "}
        <a href="/dashboard" className="text-blue-600 underline">
          go to the dashboard
        </a>
        .
      </p>
    </main>
  );
}
