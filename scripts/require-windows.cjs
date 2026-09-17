if (process.platform !== 'win32') {
  console.error('Windows build must run on a Windows host. Cross-packaging is not Windows build verification.')
  process.exit(1)
}
