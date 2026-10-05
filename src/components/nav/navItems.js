/** The four destinations, shared by the phone tab bar and the desktop nav. */
export const NAV_ITEMS = [
  { to: '/', label: 'Machines', icon: 'machines', activeFor: ['machines', 'machine'] },
  { to: '/apps', label: 'Apps', icon: 'apps', activeFor: ['apps'] },
  { to: '/containers', label: 'Containers', icon: 'containers', activeFor: ['containers'] },
  { to: '/terminal', label: 'Terminal', icon: 'terminal', activeFor: ['terminal'] },
]
