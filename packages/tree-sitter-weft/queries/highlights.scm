; Passage headers
(header "::" @punctuation.special)
(header name: (passage_name) @title)
(tag_list ["[" "]" ","] @punctuation.bracket)
(tag name: (tag_name) @property)
(tag value: (tag_value) @string)

; Comments and escapes
(line_comment) @comment
(block_comment) @comment
(escape) @string.escape

; Formatting
(emphasis) @emphasis
(strong) @emphasis.strong

; Links
(link ["[[" "]]"] @punctuation.bracket)
(link "->" @operator)
(link_label) @link_text
(passage_target) @link_uri

; Directives and inline code
(inline ["{" "}"] @punctuation.special)
(directive_name) @keyword
(directive_end) @keyword
(target "->" @operator)
(target name: (passage_name) @link_uri)
