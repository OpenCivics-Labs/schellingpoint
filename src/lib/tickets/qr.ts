import * as jose from 'jose'
import QRCode from 'qrcode'

// JWT secret for ticket QR codes - must be set in production
function getJwtSecret(): Uint8Array {
  const secret = process.env.TICKET_QR_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('TICKET_QR_SECRET or NEXTAUTH_SECRET environment variable must be set for ticket QR codes')
  }
  return new TextEncoder().encode(secret)
}

// Lazy initialization to allow startup without env vars (for pages that don't use QR)
let _jwtSecret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (!_jwtSecret) {
    _jwtSecret = getJwtSecret()
  }
  return _jwtSecret
}

// JWT expiration (90 days)
const JWT_EXPIRATION = '90d'

// Ticket QR payload
export interface TicketQRPayload {
  ticketId: string
  eventId: string
  userId: string
  tierId: string
  issuedAt: number
}

/**
 * Generate a signed JWT for a ticket
 */
export async function generateTicketToken(payload: Omit<TicketQRPayload, 'issuedAt'>): Promise<string> {
  const jwt = await new jose.SignJWT({
    ticketId: payload.ticketId,
    eventId: payload.eventId,
    userId: payload.userId,
    tierId: payload.tierId,
    issuedAt: Date.now(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION)
    .setSubject(payload.ticketId)
    .sign(getSecret())

  return jwt
}

/**
 * Verify and decode a ticket JWT
 */
export async function verifyTicketToken(token: string): Promise<TicketQRPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecret())

    return {
      ticketId: payload.ticketId as string,
      eventId: payload.eventId as string,
      userId: payload.userId as string,
      tierId: payload.tierId as string,
      issuedAt: payload.issuedAt as number,
    }
  } catch {
    return null
  }
}

/**
 * Generate a QR code data URL for a ticket
 */
export async function generateTicketQRCode(token: string): Promise<string> {
  try {
    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })

    return qrDataUrl
  } catch (error) {
    console.error('Error generating QR code:', error)
    throw new Error('Failed to generate QR code')
  }
}

/**
 * Generate QR code as SVG string (for embedding)
 */
export async function generateTicketQRSVG(token: string): Promise<string> {
  try {
    const svg = await QRCode.toString(token, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
    })

    return svg
  } catch (error) {
    console.error('Error generating QR SVG:', error)
    throw new Error('Failed to generate QR code')
  }
}

/**
 * Generate and update ticket with QR code
 * Call this after ticket is confirmed
 */
export async function generateAndStoreTicketQR(
  ticket: {
    id: string
    event_id: string
    user_id: string
    tier_id: string
  }
): Promise<string> {
  const token = await generateTicketToken({
    ticketId: ticket.id,
    eventId: ticket.event_id,
    userId: ticket.user_id,
    tierId: ticket.tier_id,
  })

  return token
}
