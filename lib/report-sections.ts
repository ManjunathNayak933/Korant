// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/report-sections.ts                                     │
// │ Single source of truth for the three payout-report "sections".         │
// │ Imported by both the edge API route (app/api/payout-report) and the    │
// │ client UI (components/PayoutReport, app/payouts/report). No side        │
// │ effects — safe to import anywhere.                                     │
// └──────────────────────────────────────────────────────────────────────┘

// A "section" is one of the marketing verticals the platform tracks. Each maps
// to (a) the agency_handlers.service that grants access, (b) the
// payouts.entity_type rows that belong to it, and (c) the events FK used to
// attribute sales/revenue.
export type ReportSection = 'influencer' | 'seo' | 'affiliate'

export interface SectionMeta {
  key: ReportSection
  label: string
  /** agency_handlers.service value that grants access to this section's report */
  service: string
  /** payouts.entity_type values that belong to this section */
  entityTypes: string[]
  /** events FK column used to attribute sales/revenue to a partner */
  eventKey: 'influencer_id' | 'publication_id' | 'affiliate_id'
  /** what the payout amount represents for this section (column header) */
  amountLabel: string
}

export const REPORT_SECTIONS: Record<ReportSection, SectionMeta> = {
  influencer: {
    key: 'influencer',
    label: 'Influencer',
    service: 'influencer_marketing',
    entityTypes: ['influencer'],
    eventKey: 'influencer_id',
    amountLabel: 'Payout',
  },
  seo: {
    key: 'seo',
    label: 'SEO',
    service: 'seo_digital_publications',
    entityTypes: ['publication'],
    eventKey: 'publication_id',
    amountLabel: 'Placement fee',
  },
  affiliate: {
    key: 'affiliate',
    label: 'Affiliate',
    service: 'affiliate',
    entityTypes: ['affiliate'],
    eventKey: 'affiliate_id',
    amountLabel: 'Commission',
  },
}

export const SECTION_ORDER: ReportSection[] = ['influencer', 'seo', 'affiliate']

export function isReportSection(v: string | null | undefined): v is ReportSection {
  return v === 'influencer' || v === 'seo' || v === 'affiliate'
}

// Given the services an agency manages for a client (agency_handlers.service[]),
// return the sections whose report they may view. This mirrors the tolerant
// matching already used in app/agency/clients/[id]/page.tsx
// (`managedServices.some(s => s.includes(service))`): a handler service
// "contains" the section key — e.g. 'influencer_marketing' ⊇ 'influencer',
// 'seo_digital_publications' ⊇ 'seo', 'affiliate' ⊇ 'affiliate'. An exact match
// against the canonical service value is also accepted for safety.
export function sectionsForServices(services: string[]): ReportSection[] {
  return SECTION_ORDER.filter(key => {
    const meta = REPORT_SECTIONS[key]
    return (services || []).some(s => s === meta.service || s.includes(key))
  })
}

export function canAccessSection(services: string[], section: ReportSection): boolean {
  return sectionsForServices(services).includes(section)
}
