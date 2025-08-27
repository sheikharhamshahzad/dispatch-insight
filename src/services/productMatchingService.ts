// Product matching and parsing utilities
// Extracted from Orders.tsx for reuse across components

// Parse product descriptions function
export const parseProductDescriptions = (description: string): { 
  product: string, 
  variant: string, 
  quantity: number,
  fullProductName: string 
}[] => {
  const products: { product: string, variant: string, quantity: number, fullProductName: string }[] = [];
  
  // First try to match products in brackets [quantity x product - variant]
  const productBlocks = description.match(/\[\s*([^\[\]]+?)\s*\]/g);
  
  if (productBlocks && productBlocks.length > 0) {
    // Process bracketed format
    for (const block of productBlocks) {
      // Remove the outer [ ]
      const productText = block.slice(1, -1).trim();
      
      // Basic pattern: quantity x product - variant
      const match = productText.match(/(\d+)\s*x\s*(.*?)(?:\s*-\s*([^-]*?)(?:\s*-|$)|$)/);
      
      if (match) {
        const quantity = parseInt(match[1], 10);
        const productName = match[2].trim();
        let variant = match[3] ? match[3].trim() : "Default";
        
        // If variant is empty or just spaces, set to Default
        if (!variant || variant === "") {
          variant = "Default";
        }
        
        // Store the complete product name for inventory matching
        const inventoryProductName = `${productName}${variant !== "Default" ? ` - ${variant}` : ""}`;
        
        products.push({
          product: productName,
          variant: variant,
          quantity: quantity,
          fullProductName: inventoryProductName
        });
      }
    }
  } else {
    // Try to match plain format: "quantity x product" or similar patterns
    const plainPatterns = [
      /(\d+)\s*x\s*(.*?)(?:\s*-\s*([^-]*?)(?:\s*-|$)|$)/i, // "1 x Product - Variant"
      /(\d+)\s*(?:pcs?|pieces?|units?)\s+(.*?)(?:\s*-\s*([^-]*?)(?:\s*-|$)|$)/i, // "1 pc Product - Variant"
      /(\d+)\s+(.*?)(?:\s*-\s*([^-]*?)(?:\s*-|$)|$)/i // "1 Product - Variant"
    ];
    
    let matched = false;
    
    for (const pattern of plainPatterns) {
      const match = description.match(pattern);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const productName = match[2].trim();
        let variant = match[3] ? match[3].trim() : "Default";
        
        if (!variant || variant === "") {
          variant = "Default";
        }
        
        const inventoryProductName = `${productName}${variant !== "Default" ? ` - ${variant}` : ""}`;
        
        products.push({
          product: productName,
          variant: variant,
          quantity: quantity,
          fullProductName: inventoryProductName
        });
        
        matched = true;
        break;
      }
    }
    
    // If no matches found and there's text, add as a single product with quantity 1
    if (!matched && description.trim()) {
      products.push({
        product: description.trim(),
        variant: "Default",
        quantity: 1,
        fullProductName: description.trim()
      });
    }
  }
  
  return products;
};

// Enhanced product matching function
export const findMatchingProduct = (
  inventoryData: { id: string; name: string; cogs: number; current_stock: number }[], 
  productName: string, 
  variant: string, 
  fullProductName: string
) => {
  console.log(`Looking for match: "${fullProductName}" (Base: "${productName}", Variant: "${variant}")`);

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/™|®|©/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // 1. Exact full name (case-insensitive)
  let match = inventoryData?.find(p =>
    p.name.toLowerCase() === fullProductName.toLowerCase()
  );
  if (match) {
    console.log(`✅ Exact full name match: ${match.name}`);
    return match;
  }

  // 2. Normalized exact match
  const normalizedFullName = normalize(fullProductName);
  match = inventoryData?.find(p =>
    normalize(p.name) === normalizedFullName
  );
  if (match) {
    console.log(`✅ Normalized full name match: ${match.name}`);
    return match;
  }

  // 3. Base product name exact match
  match = inventoryData?.find(p =>
    p.name.toLowerCase() === productName.toLowerCase()
  );
  if (match) {
    console.log(`✅ Base product name match: ${match.name}`);
    return match;
  }

  // 4. Normalized base product match
  const normalizedBaseName = normalize(productName);
  match = inventoryData?.find(p =>
    normalize(p.name) === normalizedBaseName
  );
  if (match) {
    console.log(`✅ Normalized base product match: ${match.name}`);
    return match;
  }

  // 5. Partial matches (contains)
  match = inventoryData?.find(p =>
    p.name.toLowerCase().includes(productName.toLowerCase()) ||
    productName.toLowerCase().includes(p.name.toLowerCase())
  );
  if (match) {
    console.log(`✅ Partial match: ${match.name}`);
    return match;
  }

  // 6. Normalized partial match
  match = inventoryData?.find(p => {
    const normalizedInventoryName = normalize(p.name);
    return normalizedInventoryName.includes(normalizedBaseName) ||
           normalizedBaseName.includes(normalizedInventoryName);
  });
  if (match) {
    console.log(`✅ Normalized partial match: ${match.name}`);
    return match;
  }

  // 7. Fuzzy matching - word overlap
  match = inventoryData?.find(p => {
    const inventoryWords = normalize(p.name).split(' ').filter(w => w.length > 2);
    const searchWords = normalizedBaseName.split(' ').filter(w => w.length > 2);
    
    if (inventoryWords.length === 0 || searchWords.length === 0) return false;
    
    const overlap = inventoryWords.filter(word => 
      searchWords.some(searchWord => 
        word.includes(searchWord) || searchWord.includes(word)
      )
    );
    
    return overlap.length >= Math.max(1, Math.min(inventoryWords.length, searchWords.length) * 0.5);
  });
  
  if (match) {
    console.log(`✅ Fuzzy match: ${match.name}`);
    return match;
  }

  console.log(`❌ No match found for: "${fullProductName}"`);
  return null;
};