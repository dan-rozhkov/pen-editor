import { describe, expect, it } from "vitest";
import { morphChildren } from "../morphDom";

function tree(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("morphChildren", () => {
  it("keeps identity of unchanged nodes, including img, and reports nothing inserted", () => {
    const live = tree('<div class="a"><img src="x.png"><p>hi</p></div>');
    const img = live.querySelector("img")!;
    const p = live.querySelector("p")!;
    const inserted = morphChildren(live, tree('<div class="a"><img src="x.png"><p>hi</p></div>'));
    expect(inserted).toEqual([]);
    expect(live.querySelector("img")).toBe(img);
    expect(live.querySelector("p")).toBe(p);
  });

  it("does not rewrite an unchanged src, but does write a changed one", () => {
    const live = tree('<img src="x.png" alt="a">');
    const img = live.querySelector("img")!;
    let writes = 0;
    const orig = img.setAttribute.bind(img);
    img.setAttribute = (n: string, v: string) => {
      if (n === "src") writes++;
      orig(n, v);
    };
    morphChildren(live, tree('<img src="x.png" alt="b">'));
    expect(writes).toBe(0);
    expect(img.getAttribute("alt")).toBe("b");
    morphChildren(live, tree('<img src="y.png" alt="b">'));
    expect(writes).toBe(1);
    expect(live.querySelector("img")).toBe(img);
  });

  it("updates text and comment data in place", () => {
    const live = tree("<p>Hel</p><!--a-->");
    const text = live.querySelector("p")!.firstChild!;
    morphChildren(live, tree("<p>Hello</p><!--ab-->"));
    expect(live.querySelector("p")!.firstChild).toBe(text);
    expect(live.textContent).toBe("Hello");
    expect((live.lastChild as Comment).data).toBe("ab");
  });

  it("updates <style> text only when it differs", () => {
    const live = tree("<style>.a{color:red}</style>");
    const style = live.querySelector("style")!;
    morphChildren(live, tree("<style>.a{color:red}.b{color:blue}</style>"));
    expect(live.querySelector("style")).toBe(style);
    expect(style.textContent).toBe(".a{color:red}.b{color:blue}");
  });

  it("appends new children and reports only the outermost inserted roots", () => {
    const live = tree("<section><p>one</p></section>");
    const section = live.querySelector("section")!;
    const inserted = morphChildren(live, tree("<section><p>one</p><div><span>two</span></div></section><footer>f</footer>"));
    expect(live.querySelector("section")).toBe(section);
    expect(inserted.map((e) => e.tagName)).toEqual(["DIV", "FOOTER"]);
    expect(live.querySelector("span")!.textContent).toBe("two");
  });

  it("replaces a node whose tag changed and reports it", () => {
    const live = tree("<p>x</p>");
    const inserted = morphChildren(live, tree("<h1>x</h1>"));
    expect(inserted.map((e) => e.tagName)).toEqual(["H1"]);
    expect(live.innerHTML).toBe("<h1>x</h1>");
  });

  it("syncs attributes on same-tag elements (add, change, remove) and recurses", () => {
    const live = tree('<div class="a" data-x="1"><b>t</b></div>');
    const div = live.querySelector("div")!;
    morphChildren(live, tree('<div class="b" id="i"><b>u</b></div>'));
    expect(live.querySelector("div")).toBe(div);
    expect(div.getAttribute("class")).toBe("b");
    expect(div.id).toBe("i");
    expect(div.hasAttribute("data-x")).toBe(false);
    expect(div.textContent).toBe("u");
  });

  it("removes surplus live children", () => {
    const live = tree("<p>a</p><p>b</p><p>c</p>");
    morphChildren(live, tree("<p>a</p>"));
    expect(live.children).toHaveLength(1);
  });
});
