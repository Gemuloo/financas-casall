// Testes de lógica pura (sem rede, sem DOM, sem Supabase) das funções
// responsáveis por criar os lançamentos financeiros no gemulo.html.
// Objetivo: garantir que os valores das parcelas somam certinho, que as
// datas avançam mês a mês corretamente, e que o agrupamento por grupo_id
// funciona antes de considerar o fluxo "correto".

function round2(v) {
   return Math.round((v + Number.EPSILON) * 100) / 100;
}

function rateiaValor(total, n) {
   const base = Math.floor((total / n) * 100) / 100;
   const parcelas = new Array(n).fill(base);
   const somaBase = round2(base * n);
   const resto = round2(total - somaBase);
   parcelas[n - 1] = round2(parcelas[n - 1] + resto);
   return parcelas;
}

let contadorGrupo = 0;
function gerarGrupoId() {
   contadorGrupo++;
   return 'g_test_' + contadorGrupo;
}

// Soma `n` meses a uma data preservando o dia quando possível, e "grudando"
// no último dia do mês de destino quando o dia original não existe nele
// (ex: 31/01 + 1 mês = 28 ou 29/02, nunca 03/03).
function adicionarMeses(dataISOouDate, n) {
   const d = typeof dataISOouDate === 'string' ? new Date(dataISOouDate) : new Date(dataISOouDate.getTime());
   const diaOriginal = d.getDate();
   d.setDate(1); // evita overflow de dia enquanto muda o mês
   d.setMonth(d.getMonth() + n);
   const ultimoDiaMesAlvo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
   d.setDate(Math.min(diaOriginal, ultimoDiaMesAlvo));
   return d;
}

function montarLancamentos({ desc, valorTotal, dataBase, cartaoId, categoriaId, isFixa, isParcelado, qtdParcelas, usuario }) {
   const q = isParcelado ? Math.max(1, parseInt(qtdParcelas) || 1) : 1;
   const valores = isParcelado ? rateiaValor(round2(valorTotal), q) : [round2(valorTotal)];
   const grupoId = isParcelado && q > 1 ? gerarGrupoId() : null;
   const registros = [];
   for (let i = 0; i < q; i++) {
      const dV = adicionarMeses(dataBase + 'T12:00:00', i);
      registros.push({
         descricao: isParcelado ? `${desc} (${i + 1}/${q})` : desc,
         valor: valores[i],
         cartao_id: cartaoId || null,
         categoria_id: categoriaId || null,
         is_fixa: isFixa,
         is_parcelado: isParcelado,
         grupo_id: grupoId,
         data: dV.toISOString(),
         usuario
      });
   }
   return registros;
}

// ---------- runner mínimo ----------
let passou = 0, falhou = 0;
function assert(cond, msg) {
   if (cond) { passou++; console.log(`  OK  - ${msg}`); }
   else { falhou++; console.log(`  FALHOU - ${msg}`); }
}
function secao(nome) { console.log(`\n[${nome}]`); }

// ================= TESTE 1: rateio sem resto exato (100 / 3) =================
secao('Rateio R$100,00 em 3x (dízima)');
{
   const p = rateiaValor(100, 3);
   const soma = round2(p.reduce((a, b) => a + b, 0));
   console.log('  parcelas:', p);
   assert(soma === 100, `soma das parcelas (${soma}) deve ser exatamente 100`);
   assert(p[0] === 33.33 && p[1] === 33.33, 'primeiras parcelas arredondadas para baixo (33.33)');
   assert(p[2] === 33.34, 'última parcela absorve a diferença (33.34)');
}

// ================= TESTE 2: rateio com valor "feio" (R$50,05 / 4) =================
secao('Rateio R$50,05 em 4x');
{
   const p = rateiaValor(50.05, 4);
   const soma = round2(p.reduce((a, b) => a + b, 0));
   console.log('  parcelas:', p);
   assert(soma === 50.05, `soma das parcelas (${soma}) deve ser exatamente 50.05`);
}

// ================= TESTE 3: rateio exato (R$300,00 / 3) =================
secao('Rateio exato R$300,00 em 3x');
{
   const p = rateiaValor(300, 3);
   const soma = round2(p.reduce((a, b) => a + b, 0));
   console.log('  parcelas:', p);
   assert(p.every(v => v === 100), 'todas as parcelas devem ser R$100,00 exatos');
   assert(soma === 300, `soma (${soma}) deve ser 300`);
}

// ================= TESTE 4: montarLancamentos gera N parcelas com mesmo grupo_id =================
secao('montarLancamentos - parcelado 3x mantém grupo_id e datas avançam mês a mês');
{
   const regs = montarLancamentos({
      desc: 'Sofá', valorTotal: 100, dataBase: '2026-01-31', cartaoId: 'c1', categoriaId: 'cat1',
      isFixa: false, isParcelado: true, qtdParcelas: 3, usuario: 'gemulo'
   });
   assert(regs.length === 3, 'deve gerar exatamente 3 registros');
   const gruposUnicos = new Set(regs.map(r => r.grupo_id));
   assert(gruposUnicos.size === 1 && regs[0].grupo_id !== null, 'todas as parcelas compartilham o mesmo grupo_id');
   const somaValores = round2(regs.reduce((a, r) => a + r.valor, 0));
   assert(somaValores === 100, `soma dos valores das parcelas (${somaValores}) bate com o total (100)`);
   assert(regs[0].descricao === 'Sofá (1/3)' && regs[2].descricao === 'Sofá (3/3)', 'descrições numeradas corretamente');
   const meses = regs.map(r => new Date(r.data).getUTCMonth());
   console.log('  meses das parcelas (UTC):', meses);
   assert(meses[1] === (meses[0] + 1) % 12, 'segunda parcela cai no mês seguinte');
   assert(meses[2] === (meses[0] + 2) % 12, 'terceira parcela cai dois meses depois');
}

// ================= TESTE 4b: compra no dia 31 não deve pular fevereiro =================
secao('montarLancamentos - compra em 31/01 não deve pular fevereiro (bug clássico de overflow de dia)');
{
   const regs = montarLancamentos({
      desc: 'Passagem', valorTotal: 300, dataBase: '2026-01-31', cartaoId: '', categoriaId: '',
      isFixa: false, isParcelado: true, qtdParcelas: 3, usuario: 'gemulo'
   });
   const meses = regs.map(r => new Date(r.data).getUTCMonth()); // 0=jan
   const dias = regs.map(r => new Date(r.data).getUTCDate());
   console.log('  meses:', meses, ' dias:', dias);
   assert(meses[0] === 0, 'parcela 1 em janeiro');
   assert(meses[1] === 1, 'parcela 2 deve cair em FEVEREIRO (não em março)');
   assert(meses[2] === 2, 'parcela 3 em março');
   assert(dias[1] === 28 || dias[1] === 29, 'dia da parcela de fevereiro é ajustado para o último dia do mês (28/29)');
}

// ================= TESTE 5: lançamento não parcelado gera 1 registro sem grupo_id =================
secao('montarLancamentos - gasto simples (não parcelado)');
{
   const regs = montarLancamentos({
      desc: 'Mercado', valorTotal: 250.5, dataBase: '2026-07-04', cartaoId: '', categoriaId: '',
      isFixa: false, isParcelado: false, qtdParcelas: 1, usuario: 'gemulo'
   });
   assert(regs.length === 1, 'deve gerar exatamente 1 registro');
   assert(regs[0].grupo_id === null, 'gasto não parcelado não tem grupo_id');
   assert(regs[0].valor === 250.5, 'valor mantido sem alteração');
   assert(regs[0].descricao === 'Mercado', 'descrição sem sufixo de parcela');
}

// ================= TESTE 6: virada de ano (dezembro -> janeiro) =================
secao('montarLancamentos - parcelamento atravessa virada de ano');
{
   const regs = montarLancamentos({
      desc: 'Presente Natal', valorTotal: 60, dataBase: '2026-11-30', cartaoId: '', categoriaId: '',
      isFixa: false, isParcelado: true, qtdParcelas: 3, usuario: 'gemulo'
   });
   const anos = regs.map(r => new Date(r.data).getUTCFullYear());
   const meses = regs.map(r => new Date(r.data).getUTCMonth());
   console.log('  anos:', anos, ' meses:', meses);
   assert(anos[0] === 2026 && anos[2] === 2027, 'terceira parcela cai em 2027');
}

// ================= TESTE 7: 21 parcelas (caso de valor real do usuário: 3 ACs + secadora) =================
secao('Rateio com muitas parcelas (ex: 21x de um valor não-múltiplo)');
{
   const total = 4999.90;
   const p = rateiaValor(total, 21);
   const soma = round2(p.reduce((a, b) => a + b, 0));
   assert(soma === round2(total), `soma das 21 parcelas (${soma}) bate com total (${round2(total)})`);
}

// ================= TESTE 8: hojeLocalISO não deve depender de fuso (sem UTC) =================
secao('hojeLocalISO - não deve "adiantar" o dia por causa de fuso horário');
{
   function hojeLocalISO(dataFake) {
      const d = dataFake;
      const ano = d.getFullYear();
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const dia = String(d.getDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
   }
   // Simula "23:30 no horário local do usuário", usando getFullYear/getMonth/getDate
   // (que no navegador SEMPRE respeitam o fuso do sistema, diferente de valueAsDate).
   const dataLocalSimulada = new Date(2026, 6, 4, 23, 30, 0); // 4 de julho, 23:30, mês local
   const resultado = hojeLocalISO(dataLocalSimulada);
   console.log('  23:30 local ->', resultado);
   assert(resultado === '2026-07-04', 'não deve pular para o dia 5 mesmo tarde da noite');
}

// ================= RESUMO =================
console.log(`\n=================================`);
console.log(`Resultado: ${passou} passaram, ${falhou} falharam`);
if (falhou > 0) process.exit(1);
