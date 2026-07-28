import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

type UserRow = {
  id: number
  email?: string | null
  [key: string]: unknown
}

export default async function Page() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )

  if (!isConfigured) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <h1>Supabase connection test</h1>
        <p style={{ color: 'crimson' }}>Environment variables are missing.</p>
        <p>
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in your .env.local file.
        </p>
      </main>
    )
  }

  const { data, error } = await supabase
    .schema('rental')
    .from('users')
    .select('id, email')
    .limit(5)

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Supabase connection test</h1>

      <p>
        <strong>Status:</strong>{' '}
        {error ? 'Connection failed' : 'Connection successful'}
      </p>

      {error ? (
        <div>
          <p style={{ color: 'crimson' }}>The app could not read from Supabase.</p>
          <pre>{error.message}</pre>
          <p>
            Check that the <code>users</code> table exists in the <code>rental</code>
            schema and that your database policy allows reads.
          </p>
        </div>
      ) : (
        <div>
          <p>The app can read from the database.</p>
          {data && data.length > 0 ? (
            <>
              <p>Sample rows:</p>
              <ul>
                {data.map((row: UserRow) => (
                  <li key={row.id}>{row.email ?? `User ${row.id}`}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>No rows were returned from the table.</p>
          )}
        </div>
      )}
    </main>
  )
}