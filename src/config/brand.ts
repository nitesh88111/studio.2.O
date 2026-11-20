/**
 * Adaptable Studio Brand & Sponsor Configuration
 * Update SITE_NAME and CONTACT_SLOTS whenever you finalize your brand name and contact info.
 */
export const BRAND_CONFIG = {
  siteName: 'Studio.2.O',
  brandWithAuthor: 'Studio.2.O by Nitesh',
  sponsorCredit: 'Made and Sponsored by Nitesh.T',
  heroBackgroundImage:
    '/assets/aistudio/drum-kit-dark-background-with-stage-lighting-copy-space_169016-13944_d15b3a3f.jpg',
  maxUploadBytes: 50 * 1024 * 1024, // 50 MB strict cap
  maxUndoSteps: 20, // Logical undo steps (parameter tweaks share AudioBuffer references)
  maxBufferUndoSteps: 10, // Strict cap on distinct AudioBuffer instances retained in history
  maxOverlayTracks: 2,
};

export const CONTACT_INFO = {
  email: 'niteshthormote123@gmail.com',
  enquiryText: 'For event enquiries, contact us at the same email address.',
  instagramUsername: '5_nitesh_',
  instagramUrl: 'https://www.instagram.com/5_nitesh_/',
};

export const CONTACT_SLOTS = [
  {
    id: 'email',
    label: 'Email Address',
    placeholder: CONTACT_INFO.email,
  },
  {
    id: 'enquiry',
    label: 'Event Enquiry',
    placeholder: CONTACT_INFO.enquiryText,
  },
  {
    id: 'social',
    label: 'Instagram',
    placeholder: `@${CONTACT_INFO.instagramUsername}`,
  },
];
