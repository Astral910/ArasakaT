<template><div class="glass"><slot /></div></template>
<style scoped>
.glass { background: var(--glass); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); border: 1px solid var(--glass-line); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); }
</style>
