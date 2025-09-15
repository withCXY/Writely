// Content script for AI Language Polishing & Translation Assistant
// Unified interaction model based on text selection.

let currentSelection = null;
let activeIcon = null;
let activeMenu = null;
let activeSubMenu = null;
let activeAlternativesWindow = null;
let lastUIMouseDownTime = 0; // NEW: Track the last time a UI element was clicked

// Initialize the extension
function init() {
    chrome.storage.local.get(['extensionEnabled'], (result) => {
        if (chrome.runtime.lastError) {
            console.log('Extension context invalidated during init, reloading page...');
            window.location.reload();
            return;
        }



        // 总是设置事件监听器，但在各个功能中检查启用状态
        setupEventListeners();
    });
}



// Set up event listeners for the page
function setupEventListeners() {
    // 使用捕获和冒泡两个阶段来确保事件被正确处理
    document.addEventListener('mouseup', handleTextSelection, true);
    document.addEventListener('mouseup', handleTextSelection, false);

    // 对于mousedown，我们需要更谨慎的处理
    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    // Feature A: Real-time translate-as-you-type
    document.addEventListener('input', handleInput, true);
}

// Variables for real-time translation
let translateTimeout = null;
let lastOriginalBlockText = ''; // Store the original text of the block to prevent re-translation
let isTranslating = false;

// MODIFIED: New, more precise handler for translate-as-you-type
function handleInput(event) {
    const element = event.target;
    if (!isEditableElement(element)) return;

    // For simple textareas, we can use the whole value
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        const text = element.value;
        if (!text || text.trim().length === 0) return;
        // The logic for simple inputs can remain simple, though real-time translation is best in rich editors.
        // For now, we focus on the complex contentEditable case.
        return;
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    // NEW: Find the specific block (paragraph) the user is typing in.
    const currentBlock = findCurrentBlock(selection);
    if (!currentBlock) return;

    // NEW: Get text from this block, preserving line breaks.
    const text = getTextWithLineBreaks(currentBlock).trim();

    if (!text || text.length === 0) {
        if (translateTimeout) clearTimeout(translateTimeout);
        lastOriginalBlockText = '';
        return;
    }

    if (isTranslating || text === lastOriginalBlockText) return;

    if (translateTimeout) {
        clearTimeout(translateTimeout);
    }

    translateTimeout = setTimeout(async () => {
        // 检查网站支持
        const siteSupported = await isSiteSupported();
        if (!siteSupported) return;
        console.log('AI Assistant: Starting real-time translation for block:', text.substring(0, 50) + '...');
        lastOriginalBlockText = text; // Store the text we are about to translate

        chrome.storage.local.get(['sourceLang', 'targetLang', 'translateAsYouTypeEnabled'], (settings) => {
            if (chrome.runtime.lastError) {
                window.location.reload();
                return;
            }
            if (settings.translateAsYouTypeEnabled === false) return;

            const sourceLang = settings.sourceLang || 'Chinese';
            const targetLang = settings.targetLang || 'en';

            // Pass the specific block element to the translation function
            translateText(text, sourceLang, targetLang, currentBlock);
        });

    }, 1500);
}

// MODIFIED: Real-time translation now targets a specific block element
function translateText(text, sourceLang, targetLang, blockElement) {
    if (isTranslating) return;

    isTranslating = true;

    chrome.runtime.sendMessage({
        type: 'translate',
        text: text,
        sourceLang: sourceLang,
        targetLang: targetLang,
        isRealTime: true
    }, (response) => {
        isTranslating = false;

        if (chrome.runtime.lastError || (response && response.error) || !response || !response.text) {
            console.error('AI Assistant: Translation failed:', chrome.runtime.lastError || (response && response.error));
            lastOriginalBlockText = ''; // Allow re-translation on next input
            return;
        }

        console.log('AI Assistant: Translation completed:', response.text.substring(0, 50) + '...');

        // NEW: Create a range that selects the entire content of the target block
        const range = document.createRange();
        range.selectNodeContents(blockElement);

        // Use the robust replaceText to replace only the content of that block
        // We also convert \n from the AI back into <br> for HTML
        const htmlText = response.text.replace(/\n/g, '<br>');
        replaceText(blockElement, htmlText, range, true); // Pass true for inserting HTML
    });
}


// --- Main selection-based features (largely unchanged, but will use the robust replaceText) ---

function handleTextSelection(event) {
    if (event.target.id?.startsWith('ai-assistant-')) return;

    setTimeout(async () => {
        // 检查AI Assistant是否启用（文本选择功能需要主开关开启）
        chrome.storage.local.get(['extensionEnabled'], (settings) => {
            if (chrome.runtime.lastError) {
                console.error('AI Assistant: Chrome storage error:', chrome.runtime.lastError);
                return;
            }
            if (settings.extensionEnabled === false) {
                console.log('AI Assistant: Extension is disabled');
                return;
            }

            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (!selectedText) {
                if (!isClickInsideUI(event.target)) hideAllUI();
                return;
            }

            // 增强的范围检测
            let range;
            try {
                if (selection.rangeCount > 0) {
                    range = selection.getRangeAt(0);
                } else {
                    console.log('AI Assistant: No selection range found');
                    return;
                }
            } catch (error) {
                console.error('AI Assistant: Error getting selection range:', error);
                return;
            }

            // 增强的可编辑元素检测
            const editableElement = findEditableParent(event.target) || findEditableParentFromSelection(selection);
            const isReadOnlyText = !editableElement;

            if (!editableElement) {
                console.log('AI Assistant: No editable element found - treating as read-only text');
            }

            // 保存更详细的选择信息，确保能够重新定位
            currentSelection = {
                text: selectedText,
                range: range.cloneRange(),
                element: editableElement || document.body,
                isReadOnly: isReadOnlyText,
                // 新增：保存选择的详细位置信息
                startOffset: range.startOffset,
                endOffset: range.endOffset,
                startContainer: range.startContainer,
                endContainer: range.endContainer,
                // 保存元素的文本内容快照
                elementTextContent: (editableElement || document.body).textContent || '',
                elementInnerHTML: (editableElement || document.body).innerHTML || '',
                // 保存选择在元素中的相对位置
                textIndex: (editableElement || document.body).textContent ? 
                    (editableElement || document.body).textContent.indexOf(selectedText) : -1
            };

            console.log('AI Assistant: Text selected:', selectedText.substring(0, 50) + '...');
            console.log('AI Assistant: Editable element:', editableElement?.tagName || 'none');

            showAssistantIcon(range);
        });
    }, 10);
}

function performAction(request, forAlternatives = false, toneLabel = null) {
    if (!currentSelection) {
        console.error("AI Assistant: No current selection");
        return;
    }

    console.log("AI Assistant: performAction called with:", request, "forAlternatives:", forAlternatives, "toneLabel:", toneLabel);
    console.log("AI Assistant: Selected text:", currentSelection.text);

    chrome.runtime.sendMessage({ ...request, text: currentSelection.text }, (response) => {
        console.log("AI Assistant: Received response:", response);

        if (chrome.runtime.lastError || (response && response.error) || !response || !response.text) {
            console.error('AI Assistant: Action failed:', chrome.runtime.lastError || (response && response.error));
            // Instead of alert(), show a temporary notification.
            showTemporaryNotification("An error occurred with the AI service. Please check your API key or try again later.");
            hideAllUI();
            return;
        }

        if (forAlternatives) {
            console.log("AI Assistant: Calling displayAlternatives with response.text");
            displayAlternatives(response.text);
        } else if (toneLabel) {
            console.log("AI Assistant: Calling displayToneResult with response.text");
            displayToneResult(response.text, toneLabel);
        } else {
            // 检查是否为只读文本
            if (currentSelection.isReadOnly) {
                // 只读文本：显示翻译结果而不替换
                showTranslationResult(response.text, request.targetLang);
            } else {
                // 可编辑文本：替换原文
                replaceText(currentSelection.element, response.text, currentSelection.range);
                hideAllUI();
            }
        }
    });
}

/**
 * 翻译并复制功能
 */
function performTranslateAndCopy(request) {
    if (!currentSelection) {
        console.error("AI Assistant: No current selection");
        return;
    }

    console.log("AI Assistant: performTranslateAndCopy called with:", request);
    console.log("AI Assistant: Selected text:", currentSelection.text);

    chrome.runtime.sendMessage({ ...request, text: currentSelection.text }, (response) => {
        console.log("AI Assistant: Received translate and copy response:", response);

        if (chrome.runtime.lastError || (response && response.error) || !response || !response.text) {
            console.error('AI Assistant: Translate and copy failed:', chrome.runtime.lastError || (response && response.error));
            showTemporaryNotification("翻译失败，请检查API密钥或稍后重试");
            hideAllUI();
            return;
        }

        // 复制翻译结果到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(response.text).then(() => {
                showTemporaryNotification(`翻译完成并已复制到剪贴板：${response.text.substring(0, 50)}${response.text.length > 50 ? '...' : ''}`);
                hideAllUI();
            }).catch(() => {
                // 如果剪贴板API失败，使用备用方法
                createTemporaryTextArea(response.text);
                hideAllUI();
            });
        } else {
            // 使用备用复制方法
            createTemporaryTextArea(response.text);
            hideAllUI();
        }
    });
}

function displayAlternatives(responseText) {
    console.log("AI Assistant: displayAlternatives called with:", responseText);

    if (!activeAlternativesWindow) {
        console.error("AI Assistant: activeAlternativesWindow is null");
        return;
    }

    // 💡 修复：更新时间戳，防止在显示选项时被关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: Updated timestamp in displayAlternatives");

    // 检查窗口是否还在DOM中
    if (!document.body.contains(activeAlternativesWindow)) {
        console.error("AI Assistant: activeAlternativesWindow not in DOM");
        return;
    }

    console.log("AI Assistant: Alternatives window found, clearing loading content");

    // 清空loading内容
    activeAlternativesWindow.innerHTML = '';

    // 更灵活的解析方式：尝试多种分隔符
    let alternatives = [];

    // 方法1: 尝试||分隔
    if (responseText.includes('||')) {
        alternatives = responseText.split('||').map(alt => alt.trim()).filter(alt => alt.length > 0);
    }
    // 方法2: 尝试换行分隔
    else if (responseText.includes('\n')) {
        alternatives = responseText.split('\n').map(alt => alt.trim()).filter(alt => alt.length > 0);
    }
    // 方法3: 如果没有分隔符，将整个响应作为单个选项
    else {
        alternatives = [responseText.trim()];
    }

    console.log("AI Assistant: Parsed alternatives:", alternatives);
    console.log("AI Assistant: Number of alternatives:", alternatives.length);

    if (alternatives.length === 0) {
        console.warn("AI Assistant: No alternatives found, showing error message");
        activeAlternativesWindow.innerHTML = '<div class="alternative-item">生成重写选项失败，请重试</div>';
        return;
    }

    // 为每个选项创建可点击的项目
    alternatives.forEach((alt, index) => {
        const item = document.createElement('div');
        item.className = 'alternative-item';
        item.style.cssText = `
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-bottom: 4px;
            border: 1px solid transparent;
        `;
        item.innerHTML = `<strong>选项 ${index + 1}:</strong><br>${alt}`;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
            console.log("AI Assistant: Alternative selected:", alt);

            // 使用更简单可靠的文本替换方法
            console.log("AI Assistant: Attempting to replace text with:", alt);

            if (currentSelection && currentSelection.element && currentSelection.text) {
                console.log("AI Assistant: Current selection exists, trying replacement");

                try {
                    // 方法1: 尝试使用execCommand直接替换
                    const success = document.execCommand('insertText', false, alt);
                    if (success) {
                        console.log("AI Assistant: Text replacement successful with execCommand");
                        hideAllUI();
                        return;
                    }

                    // 方法2: 对于input/textarea元素，直接操作value
                    if (currentSelection.element.tagName === 'TEXTAREA' || currentSelection.element.tagName === 'INPUT') {
                        const element = currentSelection.element;
                        const start = element.selectionStart || 0;
                        const end = element.selectionEnd || element.value.length;
                        element.value = element.value.slice(0, start) + alt + element.value.slice(end);
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log("AI Assistant: Text replacement successful for input element");
                        hideAllUI();
                        return;
                    }

                    // 方法3: 对于contenteditable元素，尝试innerHTML替换
                    if (currentSelection.element.isContentEditable) {
                        const originalText = currentSelection.text;
                        const elementHTML = currentSelection.element.innerHTML;
                        const newHTML = elementHTML.replace(originalText, alt);
                        if (newHTML !== elementHTML) {
                            currentSelection.element.innerHTML = newHTML;
                            console.log("AI Assistant: Text replacement successful with innerHTML");
                            hideAllUI();
                            return;
                        }
                    }

                    // 如果以上方法都失败，使用备用方法
                    console.log("AI Assistant: Standard methods failed, using fallback");
                    fallbackTextReplacement(alt);

                } catch (error) {
                    console.error("AI Assistant: Text replacement error:", error);
                    fallbackTextReplacement(alt);
                }
            } else {
                console.error("AI Assistant: No valid selection for replacement");
                fallbackTextReplacement(alt);
            }
            hideAllUI();
        });

        item.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now(); // 更新时间戳防止被关闭
            console.log("AI Assistant: Alternative item mousedown, updating timestamp");
        });

        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f8f9fa';
            item.style.borderColor = '#4285f4';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
            item.style.borderColor = 'transparent';
        });

        activeAlternativesWindow.appendChild(item);
    });

    console.log("AI Assistant: Successfully created", alternatives.length, "alternative items");

    // 确保窗口可见
    activeAlternativesWindow.style.display = 'block';
    activeAlternativesWindow.style.visibility = 'visible';
}

// 显示语气调整结果
function displayToneResult(responseText, toneLabel) {
    console.log("AI Assistant: displayToneResult called with:", responseText, "toneLabel:", toneLabel);

    if (!activeAlternativesWindow) {
        console.error("AI Assistant: activeAlternativesWindow is null");
        return;
    }

    // 更新时间戳，防止在显示结果时被关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: Updated timestamp in displayToneResult");

    // 检查窗口是否还在DOM中
    if (!document.body.contains(activeAlternativesWindow)) {
        console.error("AI Assistant: activeAlternativesWindow not in DOM");
        return;
    }

    console.log("AI Assistant: Tone result window found, clearing loading content");

    // 清空loading内容
    activeAlternativesWindow.innerHTML = '';

    // 创建结果显示区域
    const resultContainer = document.createElement('div');
    resultContainer.style.cssText = `
        padding: 16px;
        border-radius: 8px;
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        margin-bottom: 12px;
    `;

    // 添加标题
    const title = document.createElement('div');
    title.style.cssText = `
        font-weight: 600;
        color: #495057;
        margin-bottom: 12px;
        font-size: 14px;
    `;
    title.textContent = `${toneLabel} 语气调整结果：`;

    // 添加调整后的文本
    const resultText = document.createElement('div');
    resultText.style.cssText = `
        line-height: 1.5;
        color: #212529;
        margin-bottom: 12px;
        padding: 12px;
        background-color: #ffffff;
        border-radius: 6px;
        border: 1px solid #dee2e6;
    `;
    resultText.textContent = responseText.trim();

    // 添加操作按钮
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    `;

    // 应用按钮
    const applyButton = document.createElement('button');
    applyButton.style.cssText = `
        padding: 8px 16px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background-color 0.2s;
    `;
    applyButton.textContent = '应用此版本';
    applyButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log("AI Assistant: Tone result applied:", responseText);

        // 使用更简单可靠的文本替换方法
        console.log("AI Assistant: Attempting to replace text with tone result:", responseText.trim());

        if (currentSelection && currentSelection.element && currentSelection.text) {
            console.log("AI Assistant: Current selection exists for tone result, trying replacement");

            try {
                // 方法1: 尝试使用execCommand直接替换
                const success = document.execCommand('insertText', false, responseText.trim());
                if (success) {
                    console.log("AI Assistant: Tone result replacement successful with execCommand");
                    hideAllUI();
                    return;
                }

                // 方法2: 对于input/textarea元素，直接操作value
                if (currentSelection.element.tagName === 'TEXTAREA' || currentSelection.element.tagName === 'INPUT') {
                    const element = currentSelection.element;
                    const start = element.selectionStart || 0;
                    const end = element.selectionEnd || element.value.length;
                    element.value = element.value.slice(0, start) + responseText.trim() + element.value.slice(end);
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log("AI Assistant: Tone result replacement successful for input element");
                    hideAllUI();
                    return;
                }

                // 方法3: 对于contenteditable元素，尝试innerHTML替换
                if (currentSelection.element.isContentEditable) {
                    const originalText = currentSelection.text;
                    const elementHTML = currentSelection.element.innerHTML;
                    const newHTML = elementHTML.replace(originalText, responseText.trim());
                    if (newHTML !== elementHTML) {
                        currentSelection.element.innerHTML = newHTML;
                        console.log("AI Assistant: Tone result replacement successful with innerHTML");
                        hideAllUI();
                        return;
                    }
                }

                // 如果以上方法都失败，使用备用方法
                console.log("AI Assistant: Standard methods failed for tone result, using fallback");
                fallbackTextReplacement(responseText.trim());

            } catch (error) {
                console.error("AI Assistant: Tone result replacement error:", error);
                fallbackTextReplacement(responseText.trim());
            }
        } else {
            console.error("AI Assistant: No valid selection for tone result replacement");
            fallbackTextReplacement(responseText.trim());
        }
        hideAllUI();
    });
    applyButton.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        lastUIMouseDownTime = Date.now();
    });
    applyButton.addEventListener('mouseenter', () => {
        applyButton.style.backgroundColor = '#0056b3';
    });
    applyButton.addEventListener('mouseleave', () => {
        applyButton.style.backgroundColor = '#007bff';
    });

    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.style.cssText = `
        padding: 8px 16px;
        background-color: #6c757d;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background-color 0.2s;
    `;
    cancelButton.textContent = '取消';
    cancelButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log("AI Assistant: Tone result cancelled");
        hideAllUI();
    });
    cancelButton.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        lastUIMouseDownTime = Date.now();
    });
    cancelButton.addEventListener('mouseenter', () => {
        cancelButton.style.backgroundColor = '#545b62';
    });
    cancelButton.addEventListener('mouseleave', () => {
        cancelButton.style.backgroundColor = '#6c757d';
    });

    // 组装界面
    resultContainer.appendChild(title);
    resultContainer.appendChild(resultText);
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(applyButton);
    resultContainer.appendChild(buttonContainer);
    activeAlternativesWindow.appendChild(resultContainer);

    console.log("AI Assistant: Successfully created tone result display");

    // 确保窗口可见
    activeAlternativesWindow.style.display = 'block';
    activeAlternativesWindow.style.visibility = 'visible';
}


// --- CORE UTILITY FUNCTIONS (NEW and MODIFIED) ---

/**
 * NEW: A robust function to get text from a contentEditable element, preserving line breaks.
 * It converts <br> and block elements (<div>, <p>) into newline characters (\n).
 */
function getTextWithLineBreaks(element) {
    // 标准元素处理
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = element.innerHTML
        .replace(/<br\s*\/?>/gi, '\n') // Convert <br> to newline
        .replace(/<div>/gi, '\n')     // Convert start of <div> to newline
        .replace(/<\/div>/gi, '');    // Remove end of </div>
    // You can add more rules for <p>, etc. if needed

    return tempDiv.textContent || tempDiv.innerText || '';
}




/**
 * NEW: Finds the closest block-level element ancestor of the current selection.
 * This is our "current paragraph" or "current block".
 */
function findCurrentBlock(selection) {
    let node = selection.anchorNode;
    if (!node) return null;

    // If we're on a text node, start from its parent element
    if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
    }

    // Google Docs特殊处理
    if (isGoogleDocsEnvironment()) {
        return findGoogleDocsCurrentBlock(node);
    }

    const editableRoot = findEditableParent(node);
    if (!editableRoot) return null;

    // Traverse up until we find a direct child of the editable root, or a block element.
    while (node && node !== editableRoot) {
        const display = window.getComputedStyle(node).display;
        if (display === 'block' || display === 'list-item') {
            return node; // Found a block element
        }
        // If the parent is the root, this node is a direct child. Treat it as the block.
        if (node.parentNode === editableRoot) {
            return node;
        }
        node = node.parentNode;
    }

    // If no block is found inside, the editable element itself is the block.
    return editableRoot;
}

/**
 * Google Docs专用的当前块查找函数
 */
function findGoogleDocsCurrentBlock(node) {
    // Google Docs的段落通常在这些选择器中
    const googleDocsParagraphSelectors = [
        '.kix-paragraphrenderer',
        '.kix-lineview',
        '.kix-lineview-content',
        '.kix-wordhtmlgenerator-word-node'
    ];

    let currentNode = node;
    while (currentNode && currentNode !== document.body) {
        for (const selector of googleDocsParagraphSelectors) {
            if (currentNode.matches && currentNode.matches(selector)) {
                return currentNode;
            }
        }
        currentNode = currentNode.parentElement;
    }

    // 如果找不到特定的段落元素，返回文档容器
    return document.querySelector('.kix-page-content-wrap') ||
        document.querySelector('[role="textbox"]') ||
        node;
}


/**
 * MODIFIED: The robust text replacement function, now with Google Docs support.
 */
function replaceText(element, text, range, isHtml = false) {
    console.log('AI Assistant: Replacing text in element:', element?.tagName, 'with text:', text.substring(0, 50) + '...');

    const hostname = window.location.hostname;

    // 特殊网站处理
    if (hostname.includes('docs.google.com')) {
        replaceTextInGoogleDocs(text, range);
        return;
    }

    if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
        replaceTextInNotion(text, range);
        return;
    }

    // 标准处理方法
    try {
        // 方法1: 使用execCommand
        if (element && element.focus) {
            element.focus();
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const command = isHtml ? 'insertHTML' : 'insertText';
        const success = document.execCommand(command, false, text);

        if (success) {
            console.log('AI Assistant: Text replaced successfully using execCommand');
            selection.collapseToEnd();
            return;
        }
    } catch (error) {
        console.warn('AI Assistant: execCommand failed:', error);
    }

    // 方法2: 直接操作value属性（适用于input/textarea）
    if (element && typeof element.value !== 'undefined') {
        try {
            const start = element.selectionStart || 0;
            const end = element.selectionEnd || element.value.length;
            element.value = element.value.slice(0, start) + text + element.value.slice(end);
            element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            console.log('AI Assistant: Text replaced successfully using value property');
            return;
        } catch (error) {
            console.warn('AI Assistant: Value replacement failed:', error);
        }
    }

    // 方法3: 使用Range API直接替换
    try {
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        console.log('AI Assistant: Text replaced successfully using Range API');
    } catch (error) {
        console.error('AI Assistant: All text replacement methods failed:', error);
    }
}

/**
 * Google Docs专用的文本替换函数
 */
function replaceTextInGoogleDocs(newText, range) {
    try {
        // 方法1: 使用剪贴板API (推荐)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(newText).then(() => {
                // 选择范围
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);

                // 模拟Ctrl+V粘贴
                document.execCommand('paste');
            }).catch(() => {
                // 如果剪贴板API失败，使用备用方法
                replaceTextInGoogleDocsFallback(newText, range);
            });
        } else {
            replaceTextInGoogleDocsFallback(newText, range);
        }
    } catch (error) {
        console.error('AI Assistant: Error replacing text in Google Docs:', error);
        replaceTextInGoogleDocsFallback(newText, range);
    }
}

/**
 * Google Docs文本替换的备用方法
 */
function replaceTextInGoogleDocsFallback(newText, range) {
    // 选择文本
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // 尝试多种方法
    const methods = [
        () => document.execCommand('insertText', false, newText),
        () => document.execCommand('insertHTML', false, newText),
        () => {
            // 模拟键盘输入
            const inputEvent = new InputEvent('input', {
                inputType: 'insertText',
                data: newText,
                bubbles: true,
                cancelable: true
            });
            document.activeElement.dispatchEvent(inputEvent);
        },
        () => {
            // 最后的备用方法：逐字符输入
            for (let char of newText) {
                const keyEvent = new KeyboardEvent('keydown', {
                    key: char,
                    bubbles: true,
                    cancelable: true
                });
                document.activeElement.dispatchEvent(keyEvent);
            }
        }
    ];

    // 尝试每种方法直到成功
    for (const method of methods) {
        try {
            if (method()) {
                break;
            }
        } catch (error) {
            console.warn('AI Assistant: Method failed, trying next:', error);
        }
    }
}

/**
 * Notion专用的文本替换函数
 */
function replaceTextInNotion(newText, range) {
    console.log('AI Assistant: Replacing text in Notion');

    try {
        // 方法1: 选择文本并使用execCommand
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        if (document.execCommand('insertText', false, newText)) {
            console.log('AI Assistant: Notion text replacement successful');
            return;
        }

        // 方法2: 直接操作DOM
        range.deleteContents();
        const textNode = document.createTextNode(newText);
        range.insertNode(textNode);

        // 触发Notion的更新事件
        const inputEvent = new InputEvent('input', {
            inputType: 'insertText',
            data: newText,
            bubbles: true,
            cancelable: true
        });

        const targetElement = range.startContainer.parentElement || document.activeElement;
        targetElement.dispatchEvent(inputEvent);

        console.log('AI Assistant: Notion text replacement with DOM manipulation successful');

    } catch (error) {
        console.error('AI Assistant: Notion text replacement failed:', error);
        // Fallback to standard method
        replaceTextInGoogleDocsFallback(newText, range);
    }
}

/**
 * 备用文本替换方法 - 当主要方法失败时使用
 */
function fallbackTextReplacement(newText) {
    console.log('AI Assistant: Using fallback text replacement method');

    try {
        // 方法1: 尝试使用剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(newText).then(() => {
                // 显示提示让用户手动粘贴
                showTemporaryNotification('文本已复制到剪贴板，请按 Ctrl+V (或 Cmd+V) 粘贴');
            }).catch(() => {
                // 方法2: 创建临时文本区域
                createTemporaryTextArea(newText);
            });
        } else {
            // 方法2: 创建临时文本区域
            createTemporaryTextArea(newText);
        }
    } catch (error) {
        console.error('AI Assistant: Fallback text replacement failed:', error);
        showTemporaryNotification('文本替换失败，请手动复制：' + newText.substring(0, 50) + '...');
    }
}

/**
 * 查找包含指定文本的文本节点
 */
function findTextNode(element, text) {
    if (element.nodeType === Node.TEXT_NODE) {
        if (element.textContent.includes(text)) {
            return element;
        }
        return null;
    }

    for (let child of element.childNodes) {
        const result = findTextNode(child, text);
        if (result) {
            return result;
        }
    }

    return null;
}

/**
 * 创建临时文本区域用于复制
 */
function createTemporaryTextArea(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);

    try {
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        const successful = document.execCommand('copy');

        if (successful) {
            showTemporaryNotification('文本已复制到剪贴板，请按 Ctrl+V (或 Cmd+V) 粘贴');
        } else {
            showTemporaryNotification('无法自动复制，请手动选择文本');
        }
    } catch (error) {
        console.error('AI Assistant: Copy to clipboard failed:', error);
        showTemporaryNotification('复制失败，请手动选择文本');
    } finally {
        document.body.removeChild(textArea);
    }
}

/**
 * 显示只读文本的翻译结果
 */
function showTranslationResult(translatedText, targetLang) {
    console.log("AI Assistant: showTranslationResult called with:", translatedText);

    // 创建翻译结果窗口
    if (activeAlternativesWindow) {
        document.body.removeChild(activeAlternativesWindow);
    }

    activeAlternativesWindow = document.createElement('div');
    activeAlternativesWindow.id = 'ai-assistant-alternatives';

    // 获取选择区域的位置
    const rect = currentSelection.range.getBoundingClientRect();
    activeAlternativesWindow.style.left = `${rect.left + window.scrollX}px`;
    activeAlternativesWindow.style.top = `${rect.bottom + window.scrollY + 10}px`;

    // 防止事件冒泡
    activeAlternativesWindow.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        lastUIMouseDownTime = Date.now();
    });

    // 更新时间戳，防止在显示结果时被关闭
    lastUIMouseDownTime = Date.now();

    // 创建结果显示区域
    const resultContainer = document.createElement('div');
    resultContainer.style.cssText = `
        padding: 16px;
        border-radius: 8px;
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        margin-bottom: 12px;
        max-width: 400px;
    `;

    // 添加标题
    const title = document.createElement('div');
    title.style.cssText = `
        font-weight: 600;
        color: #495057;
        margin-bottom: 12px;
        font-size: 14px;
    `;

    const languageNames = {
        'en': 'English',
        'zh': '中文',
        'ja': '日本語',
        'ko': '한국어',
        'es': 'Español',
        'fr': 'Français'
    };

    title.textContent = `翻译结果 (${languageNames[targetLang] || targetLang})：`;

    // 添加原文
    const originalText = document.createElement('div');
    originalText.style.cssText = `
        line-height: 1.5;
        color: #6c757d;
        margin-bottom: 8px;
        padding: 8px;
        background-color: #ffffff;
        border-radius: 6px;
        border: 1px solid #dee2e6;
        font-size: 13px;
    `;
    originalText.innerHTML = `<strong>原文：</strong>${currentSelection.text}`;

    // 添加翻译后的文本
    const resultText = document.createElement('div');
    resultText.style.cssText = `
        line-height: 1.5;
        color: #212529;
        margin-bottom: 12px;
        padding: 12px;
        background-color: #ffffff;
        border-radius: 6px;
        border: 1px solid #dee2e6;
    `;
    resultText.textContent = translatedText.trim();

    // 添加操作按钮
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    `;

    // 复制按钮
    const copyButton = document.createElement('button');
    copyButton.style.cssText = `
        padding: 8px 16px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background-color 0.2s;
    `;
    copyButton.textContent = '复制翻译';
    copyButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(translatedText.trim()).then(() => {
                showTemporaryNotification('翻译结果已复制到剪贴板');
                hideAllUI();
            }).catch(() => {
                createTemporaryTextArea(translatedText.trim());
                hideAllUI();
            });
        } else {
            createTemporaryTextArea(translatedText.trim());
            hideAllUI();
        }
    });
    copyButton.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        lastUIMouseDownTime = Date.now();
    });
    copyButton.addEventListener('mouseenter', () => {
        copyButton.style.backgroundColor = '#0056b3';
    });
    copyButton.addEventListener('mouseleave', () => {
        copyButton.style.backgroundColor = '#007bff';
    });

    // 关闭按钮
    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        padding: 8px 16px;
        background-color: #6c757d;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background-color 0.2s;
    `;
    closeButton.textContent = '关闭';
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        hideAllUI();
    });
    closeButton.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        lastUIMouseDownTime = Date.now();
    });
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.backgroundColor = '#545b62';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.backgroundColor = '#6c757d';
    });

    // 组装界面
    resultContainer.appendChild(title);
    resultContainer.appendChild(originalText);
    resultContainer.appendChild(resultText);
    buttonContainer.appendChild(closeButton);
    buttonContainer.appendChild(copyButton);
    resultContainer.appendChild(buttonContainer);
    activeAlternativesWindow.appendChild(resultContainer);

    console.log("AI Assistant: Successfully created translation result display");

    // 确保窗口可见
    activeAlternativesWindow.style.display = 'block';
    activeAlternativesWindow.style.visibility = 'visible';

    document.body.appendChild(activeAlternativesWindow);
}

// --- Helper Functions ---
function isEditableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // 标准可编辑元素
    if (element.isContentEditable ||
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA') {
        return true;
    }

    // 检查contenteditable属性
    if (element.getAttribute('contenteditable') === 'true') {
        return true;
    }

    // 特殊网站检测
    const hostname = window.location.hostname;

    // Google Docs
    if (hostname.includes('docs.google.com')) {
        return isGoogleDocsEditableElement(element);
    }

    // Notion
    if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
        return element.hasAttribute('data-block-id') ||
            element.classList.contains('notion-page-content') ||
            element.getAttribute('contenteditable') === 'true';
    }

    // GitHub
    if (hostname.includes('github.com')) {
        return element.classList.contains('CodeMirror') ||
            element.classList.contains('CodeMirror-line') ||
            element.tagName === 'TEXTAREA';
    }

    // Medium
    if (hostname.includes('medium.com')) {
        return element.classList.contains('graf') ||
            element.getAttribute('contenteditable') === 'true';
    }

    // 通用检测 - 检查常见的编辑器类名
    const editableClasses = [
        'editor', 'content-editable', 'editable', 'rich-text',
        'text-editor', 'wysiwyg', 'draft-editor', 'ql-editor'
    ];

    return editableClasses.some(className =>
        element.classList.contains(className)
    );
}

// 检测是否在Google Docs环境中
function isGoogleDocsEnvironment() {
    const isGoogleDocs = window.location.hostname === 'docs.google.com' &&
        window.location.pathname.includes('/document/');
    console.log('AI Assistant: Google Docs environment check:', isGoogleDocs, window.location.href);
    return isGoogleDocs;
}

// 检查网站支持 - 现在支持所有网站
function isSiteSupported() {
    return Promise.resolve(true); // 支持所有网站
}

// 检测Google Docs中的可编辑元素
function isGoogleDocsEditableElement(element) {
    // Google Docs的文档内容通常在特定的容器中
    const googleDocsSelectors = [
        '.kix-appview-editor',
        '.kix-page-content-wrap',
        '.kix-paragraphrenderer',
        '.kix-lineview',
        '.kix-lineview-content',
        '.kix-wordhtmlgenerator-word-node',
        '[role="textbox"]',
        '.docs-texteventtarget-iframe',
        '.kix-canvas-tile-content',
        '.kix-selection-overlay'
    ];

    // 检查元素本身或其父元素是否匹配Google Docs选择器
    let currentElement = element;
    while (currentElement && currentElement !== document.body) {
        for (const selector of googleDocsSelectors) {
            if (currentElement.matches && currentElement.matches(selector)) {
                return true;
            }
        }
        currentElement = currentElement.parentElement;
    }

    // 检查是否在Google Docs的iframe中
    if (window.parent !== window) {
        try {
            const parentUrl = window.parent.location.href;
            if (parentUrl.includes('docs.google.com')) {
                return true;
            }
        } catch (e) {
            // 跨域限制，但可能在Google Docs iframe中
            return true;
        }
    }

    return false;
}

function findEditableParent(node) {
    while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && isEditableElement(node)) {
            return node;
        }
        node = node.parentNode;
    }

    // 特殊网站处理
    return findSpecialSiteEditableElement();
}

// 从选择范围中查找可编辑元素
function findEditableParentFromSelection(selection) {
    if (!selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // 从选择的公共祖先开始查找
    let node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;

    while (node && node !== document.body) {
        if (isEditableElement(node)) {
            return node;
        }
        node = node.parentNode;
    }

    return findSpecialSiteEditableElement();
}

// 特殊网站的可编辑元素检测
function findSpecialSiteEditableElement() {
    const hostname = window.location.hostname;

    // Google Docs
    if (hostname.includes('docs.google.com')) {
        return document.querySelector('.kix-page-content-wrap') ||
            document.querySelector('[role="textbox"]') ||
            document.querySelector('.docs-texteventtarget-iframe') ||
            document.querySelector('.kix-appview-editor');
    }

    // Notion
    if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
        return document.querySelector('[contenteditable="true"]') ||
            document.querySelector('.notion-page-content') ||
            document.querySelector('[data-block-id]');
    }

    // GitHub
    if (hostname.includes('github.com')) {
        return document.querySelector('.CodeMirror') ||
            document.querySelector('textarea') ||
            document.querySelector('[contenteditable="true"]');
    }

    // Medium
    if (hostname.includes('medium.com')) {
        return document.querySelector('[contenteditable="true"]') ||
            document.querySelector('.graf');
    }

    // 通用fallback - 查找任何可编辑元素
    return document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea') ||
        document.querySelector('input[type="text"]') ||
        document.querySelector('.editor') ||
        document.querySelector('.content-editable');
}

function showAssistantIcon(range) { hideAllUI(); const rect = range.getBoundingClientRect(); activeIcon = document.createElement('div'); activeIcon.id = 'ai-assistant-icon'; activeIcon.style.left = `${rect.right + window.scrollX + 5}px`; activeIcon.style.top = `${rect.top + window.scrollY + rect.height / 2 - 14}px`; activeIcon.addEventListener('click', (e) => { e.stopPropagation(); showPrimaryMenu(); }); document.body.appendChild(activeIcon); }
function showPrimaryMenu() {
    const iconRect = activeIcon.getBoundingClientRect();
    hideAllUI();
    activeMenu = document.createElement('div');
    activeMenu.id = 'ai-assistant-menu';
    activeMenu.style.left = `${iconRect.left + window.scrollX}px`;
    activeMenu.style.top = `${iconRect.bottom + window.scrollY + 5}px`;
    // NEW: Also prevent default to be more robust
    activeMenu.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); lastUIMouseDownTime = Date.now(); });

    // 根据是否为只读文本显示不同的菜单选项
    let options;
    if (currentSelection && currentSelection.isReadOnly) {
        // 只读文本菜单：只提供翻译和复制功能
        options = [
            { key: 'translate', label: '翻译 (Translate) ▸' },
            { key: 'translate_copy', label: '翻译并复制 (Translate & Copy) ▸' },
            { key: 'close_extension', label: '关闭插件 (Close)' }
        ];
    } else {
        // 可编辑文本菜单：提供完整功能
        options = [
            { key: 'translate', label: '翻译 (Translate) ▸' },
            { key: 'rewrite', label: '重写 (Rewrite)' },
            { key: 'change_tone', label: '调整语气 (Tone) ▸' },
            { key: 'close_extension', label: '关闭插件 (Close)' }
        ];
    }

    options.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.label;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
            console.log("AI Assistant: Button clicked:", option.key);
            handlePrimaryMenuClick(option.key);
        });
        button.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
        });
        activeMenu.appendChild(button);
    });
    document.body.appendChild(activeMenu);
}
function handlePrimaryMenuClick(key) {
    // 立即更新时间戳
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: Primary menu click:", key, "timestamp updated");

    switch (key) {
        case 'translate':
            showTranslateSubMenu();
            break;
        case 'translate_copy':
            showTranslateSubMenu(true); // 传递参数表示翻译后复制
            break;
        case 'rewrite':
            showRewriteWindow(); // 显示重写浮窗
            break;
        case 'change_tone':
            showToneSubMenu();
            break;
        case 'close_extension':
            closeExtension();
            break;
    }
}
function showToneSubMenu() {
    const menuRect = activeMenu.getBoundingClientRect();
    activeSubMenu = document.createElement('div');
    activeSubMenu.id = 'ai-assistant-menu';
    activeSubMenu.style.left = `${menuRect.right + window.scrollX + 5}px`;
    activeSubMenu.style.top = `${menuRect.top + window.scrollY}px`;
    activeSubMenu.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); lastUIMouseDownTime = Date.now(); });

    const toneOptions = [
        { key: 'formal', label: 'Formal' },
        { key: 'casual', label: 'Casual' },
        { key: 'fluent', label: 'Fluent' },
        { key: 'reasoning', label: 'Reasoning' }
    ];

    toneOptions.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.label;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
            console.log("AI Assistant: Tone button clicked:", option.key);
            showToneWindow(option.key, option.label);
        });
        button.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
        });
        activeSubMenu.appendChild(button);
    });
    document.body.appendChild(activeSubMenu);
}

// 显示重写浮窗
function showRewriteWindow() {
    // 立即更新时间戳，防止被关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: showRewriteWindow called, timestamp updated immediately");

    if (!activeMenu) {
        console.error("AI Assistant: activeMenu is null");
        return;
    }

    // 额外的保护：设置一个标志来防止意外关闭
    window.aiAssistantCreatingWindow = true;
    setTimeout(() => {
        window.aiAssistantCreatingWindow = false;
    }, 2000); // 2秒保护期

    // 获取菜单位置
    const menuRect = activeMenu.getBoundingClientRect();
    console.log("AI Assistant: Menu rect:", menuRect);

    // 创建重写窗口
    activeAlternativesWindow = document.createElement('div');
    activeAlternativesWindow.id = 'ai-assistant-rewrite';

    // 设置样式
    activeAlternativesWindow.style.cssText = `
        position: absolute;
        left: ${menuRect.left + window.scrollX}px;
        top: ${menuRect.top + window.scrollY}px;
        z-index: 9999999;
        background-color: #ffffff;
        color: #333;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        padding: 12px;
        max-width: 400px;
        width: 380px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        border: 1px solid #e0e0e0;
        display: block;
        visibility: visible;
    `;

    // 只阻止mousedown事件，允许click事件正常工作
    activeAlternativesWindow.addEventListener('mousedown', e => {
        e.stopPropagation();
        lastUIMouseDownTime = Date.now();
        console.log("AI Assistant: Rewrite window mousedown, updating timestamp");
    }, true);

    // 对于click事件，只阻止冒泡但不阻止默认行为
    activeAlternativesWindow.addEventListener('click', e => {
        e.stopPropagation();
        lastUIMouseDownTime = Date.now();
        console.log("AI Assistant: Rewrite window click, updating timestamp");
    }, true);

    // 显示加载状态
    activeAlternativesWindow.innerHTML = `
        <div style="text-align: center; color: #666; padding: 20px;">
            <div style="margin-bottom: 10px;">🔄 正在生成重写版本...</div>
            <div style="font-size: 12px; color: #999;">请稍候，AI正在为您创建三个不同的重写版本</div>
        </div>
    `;

    document.body.appendChild(activeAlternativesWindow);
    console.log("AI Assistant: Rewrite window created and added to DOM");

    // 再次更新时间戳，确保浮窗不会被立即关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: Timestamp updated after rewrite window creation");

    // 清除创建标志，但延迟一点以确保稳定
    setTimeout(() => {
        window.aiAssistantCreatingWindow = false;
        console.log("AI Assistant: Window creation protection cleared");
    }, 1000);

    // 隐藏菜单
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }

    // 调用API获取重写内容
    performAction({ type: 'alternatives' }, true);
}

// 显示语气调整浮窗
function showToneWindow(toneKey, toneLabel) {
    // 立即更新时间戳，防止被关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: showToneWindow called with tone:", toneKey, "timestamp updated immediately");

    if (!activeSubMenu) {
        console.error("AI Assistant: activeSubMenu is null");
        return;
    }

    // 额外的保护：设置一个标志来防止意外关闭
    window.aiAssistantCreatingWindow = true;
    setTimeout(() => {
        window.aiAssistantCreatingWindow = false;
    }, 2000); // 2秒保护期

    // 获取子菜单位置
    const subMenuRect = activeSubMenu.getBoundingClientRect();
    console.log("AI Assistant: SubMenu rect:", subMenuRect);

    // 创建语气调整窗口
    activeAlternativesWindow = document.createElement('div');
    activeAlternativesWindow.id = 'ai-assistant-tone';

    // 设置样式
    activeAlternativesWindow.style.cssText = `
        position: absolute;
        left: ${subMenuRect.left + window.scrollX}px;
        top: ${subMenuRect.top + window.scrollY}px;
        z-index: 9999999;
        background-color: #ffffff;
        color: #333;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        padding: 12px;
        max-width: 400px;
        width: 380px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        border: 1px solid #e0e0e0;
        display: block;
        visibility: visible;
    `;

    // 只阻止mousedown事件，允许click事件正常工作
    activeAlternativesWindow.addEventListener('mousedown', e => {
        e.stopPropagation();
        lastUIMouseDownTime = Date.now();
        console.log("AI Assistant: Tone window mousedown, updating timestamp");
    }, true);

    // 对于click事件，只阻止冒泡但不阻止默认行为
    activeAlternativesWindow.addEventListener('click', e => {
        e.stopPropagation();
        lastUIMouseDownTime = Date.now();
        console.log("AI Assistant: Tone window click, updating timestamp");
    }, true);

    // 显示加载状态
    activeAlternativesWindow.innerHTML = `
        <div style="text-align: center; color: #666; padding: 20px;">
            <div style="margin-bottom: 10px;">🔄 正在调整语气为 ${toneLabel}...</div>
            <div style="font-size: 12px; color: #999;">请稍候，AI正在为您调整文本语气</div>
        </div>
    `;

    document.body.appendChild(activeAlternativesWindow);
    console.log("AI Assistant: Tone window created and added to DOM");

    // 再次更新时间戳，确保浮窗不会被立即关闭
    lastUIMouseDownTime = Date.now();
    console.log("AI Assistant: Timestamp updated after tone window creation");

    // 清除创建标志，但延迟一点以确保稳定
    setTimeout(() => {
        window.aiAssistantCreatingWindow = false;
        console.log("AI Assistant: Window creation protection cleared");
    }, 1000);

    // 隐藏菜单和子菜单
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
    if (activeSubMenu) {
        activeSubMenu.remove();
        activeSubMenu = null;
    }

    // 调用API获取语气调整内容
    performAction({ type: 'polish', style: toneKey }, false, toneLabel);
}

function showTranslateSubMenu(copyMode = false) {
    const menuRect = activeMenu.getBoundingClientRect();
    activeSubMenu = document.createElement('div');
    activeSubMenu.id = 'ai-assistant-menu';
    activeSubMenu.style.left = `${menuRect.right + window.scrollX + 5}px`;
    activeSubMenu.style.top = `${menuRect.top + window.scrollY}px`;
    activeSubMenu.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); lastUIMouseDownTime = Date.now(); });

    const translateOptions = [
        { key: 'en', label: 'English' },
        { key: 'zh', label: '中文' },
        { key: 'ja', label: '日本語' },
        { key: 'ko', label: '한국어' },
        { key: 'es', label: 'Español' },
        { key: 'fr', label: 'Français' }
    ];

    translateOptions.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.label;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
            console.log("AI Assistant: Translate button clicked:", option.key, "copyMode:", copyMode);

            if (copyMode) {
                // 翻译并复制模式
                performTranslateAndCopy({ type: 'translate', targetLang: option.key });
            } else {
                // 普通翻译模式
                performAction({ type: 'translate', targetLang: option.key });
            }
        });
        button.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            lastUIMouseDownTime = Date.now();
        });
        activeSubMenu.appendChild(button);
    });
    document.body.appendChild(activeSubMenu);
}

function closeExtension() {
    chrome.storage.local.set({ extensionEnabled: false }, () => {
        hideAllUI();
        showTemporaryNotification("AI Assistant has been disabled. You can re-enable it from the extension popup.");
    });
}

function isClickInsideUI(target) {
    // Check if the click is inside any of our UI elements
    const isInIcon = activeIcon && (target === activeIcon || activeIcon.contains(target));
    const isInMenu = activeMenu && (target === activeMenu || activeMenu.contains(target));
    const isInSubMenu = activeSubMenu && (target === activeSubMenu || activeSubMenu.contains(target));
    const isInAlternatives = activeAlternativesWindow && (target === activeAlternativesWindow || activeAlternativesWindow.contains(target));

    // Check for any element with our ID prefix
    const isUIElement = target.id?.startsWith('ai-assistant-') ||
        target.closest('[id^="ai-assistant-"]') ||
        target.className?.includes('alternative-item');

    // Check for protection flag
    const isProtected = window.aiAssistantCreatingWindow;

    return isInIcon || isInMenu || isInSubMenu || isInAlternatives || isUIElement || isProtected;
}
function handleDocumentMouseDown(event) {
    const currentTime = Date.now();
    const timeSinceLastUI = currentTime - lastUIMouseDownTime;

    console.log("AI Assistant: Document mousedown - target:", event.target.tagName, event.target.id, event.target.className);
    console.log("AI Assistant: Time since last UI interaction:", timeSinceLastUI, "ms");
    console.log("AI Assistant: Creating window flag:", window.aiAssistantCreatingWindow);

    // 检查保护标志
    if (window.aiAssistantCreatingWindow) {
        console.log("AI Assistant: Ignoring mousedown - window creation in progress");
        return;
    }

    // 检查是否点击的是我们的UI元素
    const isUIClick = event.target.id?.startsWith('ai-assistant-') ||
        event.target.closest('[id^="ai-assistant-"]') ||
        event.target.className?.includes('alternative-item');

    if (isUIClick) {
        console.log("AI Assistant: Click on UI element, updating timestamp and ignoring");
        lastUIMouseDownTime = Date.now();
        return;
    }

    // 💡 修复：大幅增加保护时间，特别是对于浮窗创建
    if (timeSinceLastUI < 1000) { // 增加到1000ms (1秒)
        console.log("AI Assistant: Ignoring mousedown due to recent UI interaction");
        return;
    }

    // 延迟检查，让其他事件处理器先执行
    setTimeout(() => {
        const delayedTime = Date.now();
        const delayedTimeSinceLastUI = delayedTime - lastUIMouseDownTime;

        console.log("AI Assistant: Delayed check - time since last UI:", delayedTimeSinceLastUI, "ms");

        // 再次检查时间戳，防止在延迟期间有新的UI交互
        if (delayedTimeSinceLastUI < 1000) {
            console.log("AI Assistant: Ignoring delayed mousedown due to recent UI interaction");
            return;
        }

        const isInside = isClickInsideUI(event.target);
        console.log("AI Assistant: Is click inside UI:", isInside);

        if (!isInside) {
            console.log("AI Assistant: Hiding UI due to outside click");
            hideAllUI();
        }
    }, 200); // 增加延迟时间到200ms
}
function hideAllUI() {
    console.log("AI Assistant: hideAllUI called - removing UI elements");
    console.log("AI Assistant: Active elements - Icon:", !!activeIcon, "Menu:", !!activeMenu, "SubMenu:", !!activeSubMenu, "Alternatives:", !!activeAlternativesWindow);

    if (activeIcon) {
        activeIcon.remove();
        activeIcon = null;
        console.log("AI Assistant: Removed activeIcon");
    }
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
        console.log("AI Assistant: Removed activeMenu");
    }
    if (activeSubMenu) {
        activeSubMenu.remove();
        activeSubMenu = null;
        console.log("AI Assistant: Removed activeSubMenu");
    }
    if (activeAlternativesWindow) {
        activeAlternativesWindow.remove();
        activeAlternativesWindow = null;
        console.log("AI Assistant: Removed activeAlternativesWindow");
    }
}
function showTemporaryNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #f44336;
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Initialize the script
init();