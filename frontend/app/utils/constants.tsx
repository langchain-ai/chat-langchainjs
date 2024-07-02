const apiBasePath = process.env.NEXT_PUBLIC_VERCEL_URL
  ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  : `http://localhost:3000`;
export const apiBaseUrl = `${apiBasePath}/api`;
