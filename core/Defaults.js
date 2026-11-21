/** Defaults.js - settings written when the database is created. Nothing else is pre-filled. */
function default_settings_() {
  return [
    { key: 'appName', value: 'Batch Readiness', description: 'Name shown in the header' },
    { key: 'maxUsers', value: '12', description: 'Maximum number of (non-disabled) users' },
    { key: 'allowRegistration', value: 'yes', description: 'yes = people can register (an administrator must approve them)' },
    { key: 'inviteCode', value: '', description: 'Optional code that new users must enter when registering' },
    { key: 'acceptedDocStatuses', value: 'Effective;Released', description: 'Document statuses that count as usable' },
    { key: 'acceptedEquipmentStatuses', value: 'Released;Ready for use', description: 'Equipment statuses that count as usable' },
    { key: 'acceptedBioStatuses', value: 'Released;Available', description: 'Bio inventory statuses that count as usable' },
    { key: 'acceptedBulkStatuses', value: 'Stored;Released', description: 'Bulk storage statuses that count as stock' },
    { key: 'acceptedStockCategories', value: 'F1', description: 'ERP stock categories that count as usable stock' },
    { key: 'equipmentBufferDays', value: '14', description: 'Calibration/qualification must be valid this many days after the batch start' },
    { key: 'exportMaxAgeDays', value: '3', description: 'Warn if the ERP export is older than this' },
    { key: 'psaAreaName', value: 'PSA', description: 'Area name (see StorageTypes) of the production supply area' },
    { key: 'productionUsedFor', value: 'Production', description: 'Used-for values that are NOT sample related' },
    { key: 'usedForList', value: 'Production', description: 'Choices for the Used for column' },
    { key: 'webhookUrl', value: '', description: 'Optional: URL that receives events (campaign.confirmed, batch.*). Leave empty to disable' },
    { key: 'webhookSecret', value: '', description: 'Optional: secret used to sign webhook bodies (HMAC-SHA256, header X-BR-Signature)' },
    { key: 'webhookEvents', value: '', description: 'Optional: comma separated event names to send; empty = all' }
  ];}
