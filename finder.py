from html.parser import HTMLParser
import json
from pathlib import Path

class SearchText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts=[]
        self.hidden=False
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.hidden=True
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.hidden=False
    def handle_data(self,data):
        if not self.hidden and data.strip():self.parts.append(data.strip())

def build_finder(page,rows):
    data=json.dumps(rows,ensure_ascii=False,separators=(',',':')).replace('<',r'\u003c')
    content=('<form class="lookup-form" role="search"><input id="lookup" type="search" autofocus aria-label="全站关键词" placeholder="公司、机构、融资或研究关键词" enterkeyhint="search"></form>'
             '<p class="search-entry"><a href="search.html">按机构、年份和轮次组合筛选融资 →</a></p><p id="found-count" role="status"></p>'
             '<section id="found"></section><button id="show-more" hidden>更多结果</button>'
             '<script type="application/json" id="lookup-index">'+data+'</script><script>'+Path('finder.js').read_text()+'</script>')
    page('find.html','全站搜索','',content,cover=True)
