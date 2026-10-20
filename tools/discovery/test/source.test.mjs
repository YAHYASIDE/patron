// The small source reader the checks rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClasses, stripComments, tokenize } from '../lib/source.mjs';
import { readDictionary } from '../checks/i18n-missing.mjs';

test('comments are blanked, strings and line numbers kept', () => {
  const src = "const a = 'x // not a comment'; // gone\n/* gone\n too */ const b = `y ${1}`;";
  const out = stripComments(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes("'x // not a comment'"));
  assert.ok(!out.includes('gone'));
  assert.ok(out.includes('`y ${1}`'));
});

test('a regex literal with quotes or slashes does not derail the reader', () => {
  const src = "const r = /it's [/]/g; // tail\nconst s = 'ok';";
  const out = stripComments(src);
  assert.ok(!out.includes('tail'));
  assert.ok(out.includes("'ok'"));
});

test('decorated classes and methods are read, including inline and multi-line decorators', () => {
  const code = stripComments(`
    @Controller('admin/x')
    export class X {
      constructor(private s: S) {}
      @ApiOperation({ summary: 'a { b', description: \`c ) d\` })
      @RequirePermissions('x.read') @Get(':id')
      async get(@Param('id') id: string): Promise<{ id: string }> {
        if (id) { return { id }; }
        return { id: '' };
      }
      private helper = () => { return 1; };
      @Post() create() {}
    }
    class Y { @Get() list() {} }
  `);
  const [x, y] = parseClasses(code);
  assert.equal(x.name, 'X');
  assert.deepEqual(x.decorators.map((d) => d.name), ['Controller']);
  assert.deepEqual(x.methods.map((m) => m.name), ['constructor', 'get', 'create']);
  assert.deepEqual(x.methods[1].decorators.map((d) => d.name), ['ApiOperation', 'RequirePermissions', 'Get']);
  assert.equal(x.methods[1].decorators[2].args, "':id'");
  assert.deepEqual(x.methods[2].decorators.map((d) => d.name), ['Post']);
  assert.equal(y.methods[0].name, 'list');
});

test('tokens include Unicode identifiers', () => {
  const t = tokenize("حذف: 'Supprimer'");
  assert.deepEqual(t.map((x) => x.type), ['id', 'punct', 'str']);
  assert.equal(t[0].value, 'حذف');
});

test('dictionaries are read without evaluating them', () => {
  const d = readDictionary("const dict = { fr: { حذف: 'Supprimer', 'a {n}': 'b ' + '{n}' }, en: { \"x\": `y` } };");
  assert.deepEqual(d, { fr: { حذف: 'Supprimer', 'a {n}': 'b {n}' }, en: { x: 'y' } });
});

test('a regex with brackets inside a method body does not hide the methods after it', () => {
  const code = stripComments(`
    @Controller('admin/r')
    export class R {
      @Get() a() { const re = /[{(]/g; return 'x'.replace(re, ''); }
      @Get('b') b() { const t = /}{"'\`/; const u = x / 2 / y; return t.test(\`\${u}\`); }
      @Post('c') c() { return /\\/[}]/.source; }
      @Delete('d') d() { return 1; }
    }
    class After { @Get() z() {} }
  `);
  const classes = parseClasses(code);
  assert.deepEqual(classes.map((c) => c.name), ['R', 'After']);
  assert.deepEqual(classes[0].methods.map((m) => m.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(classes[0].methods[3].decorators.map((d) => d.name), ['Delete']);
});
