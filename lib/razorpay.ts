// Razorpay coupon auto-creation
// Uses Razorpay Offers API to create discount coupons

async function razorpayFetch(keyId: string, keySecret: string, path: string, method = 'GET', body?: unknown) {
  const auth = btoa(`${keyId}:${keySecret}`)
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay ${method} ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function getClientRazorpay(clientId: string) {
  // Razorpay credentials stored in client settings
  // For now read from env or client table (add razorpay_key_id, razorpay_key_secret columns later)
  // Using global env vars for now
  const keyId = (globalThis as any).process?.env?.RAZORPAY_KEY_ID
  const keySecret = (globalThis as any).process?.env?.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return null
  return { keyId, keySecret }
}

export async function createRazorpayOffer(
  clientId: string,
  couponCode: string,
  discountPercent: number = 10,
  description?: string
): Promise<{ offerId: string } | null> {
  const creds = await getClientRazorpay(clientId)
  if (!creds) return null

  try {
    // Create an offer (coupon) in Razorpay
    const res = await razorpayFetch(creds.keyId, creds.keySecret, '/offers', 'POST', {
      name: description || `MicroKorant - ${couponCode}`,
      payment_offer: {
        type: 'instant',
        value: discountPercent * 100, // in paise percent points
        applicable_on: 'total_cart_value',
      },
      checkout_options: {
        coupon_code: couponCode,
      },
      display_text: `${discountPercent}% off with code ${couponCode}`,
    })
    return { offerId: res.id }
  } catch (e) {
    console.error('Razorpay offer creation failed:', e)
    return null
  }
}

export async function deleteRazorpayOffer(offerId: string, clientId: string): Promise<void> {
  const creds = await getClientRazorpay(clientId)
  if (!creds) return
  try {
    await razorpayFetch(creds.keyId, creds.keySecret, `/offers/${offerId}`, 'DELETE')
  } catch (e) {
    console.error('Razorpay offer deletion failed:', e)
  }
}