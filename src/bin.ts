import Helm2CattleOperator from './helm2cattle';
import config from './config';

(async () => {
  const helm2Cattle = new Helm2CattleOperator(config);
  await helm2Cattle.start();

  function exit(_reason: string) {
    helm2Cattle.stop();
    process.exit(0);
  }

  process
    .on('SIGTERM', () => exit('SIGTERM'))
    .on('SIGINT', () => exit('SIGINT'));
})().catch(console.error);
